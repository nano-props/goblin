import { afterEach, beforeEach, expect, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  commitWorkspaceProbeState,
} from '#/server/modules/workspace-runtimes.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import { REALTIME_HEARTBEAT_DEADLINE_MS as HEARTBEAT_DEADLINE_MS } from '#/server/realtime/realtime-broker.ts'
import { readWorktreeMembership } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeOpenInput,
  type WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'

// No library test double spans node-pty, realtime sockets, runtime membership, and durable pane layout.
// Keep that integration fixture shared while each suite owns one observable runtime behavior.
export const USER_1 = 'user_terminal_runtime'
export const USER_2 = 'user_terminal_runtime_second'
export const REPO_ROOT = requiredWorkspaceLocator('goblin+file:///repo')
export const LINKED_REPO_ROOT = requiredWorkspaceLocator('goblin+file:///repo-linked')
export let WORKSPACE_RUNTIME_ID = ''
export let SSH_WORKSPACE_RUNTIME_ID = ''
export let USER_2_WORKSPACE_RUNTIME_ID = ''
export const TEST_NOW = new Date('2026-06-24T00:00:00Z')
export const DETACHED_TTL_MS = 24 * 60 * 60 * 1000
export const CLIENT_STATE_GRACE_MS = 30_000
export const HEARTBEAT_SILENCE_MS = HEARTBEAT_DEADLINE_MS

export function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

export function workspacePaneTabsListInput(workspaceRuntimeId: string) {
  return { workspaceId: REPO_ROOT, workspaceRuntimeId }
}

export function workspacePaneWorktreeTarget(workspaceRuntimeId: string) {
  return {
    kind: 'git-worktree' as const,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId,
    root: LINKED_REPO_ROOT,
  }
}

export function commitTerminalReadyProbe(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): void {
  const committed = commitWorkspaceProbeState({
    userId,
    workspaceId,
    workspaceRuntimeId,
    probe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
  if (!committed) throw new Error('test runtime probe was not awaiting its authoritative initial result')
}

vi.mock('#/system/git/worktrees.ts', () => ({
  readWorktreeMembership: vi.fn(async () => [
    { path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false },
  ]),
}))

vi.mock('#/system/ssh/config.ts', () => ({
  resolveRemoteTarget: vi.fn(async () => ({
    target: {
      id: 'goblin+ssh://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
  })),
  resolveRemoteTargetWithConfigFingerprint: vi.fn(async () => ({
    target: {
      id: 'goblin+ssh://prod/srv/repo',
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
    },
    configFingerprint: 'terminal-runtime-test-config-fingerprint',
  })),
}))

export const readWorktreeMembershipMock = vi.mocked(readWorktreeMembership)
export const resolveRemoteTargetMock = vi.mocked(resolveRemoteTarget)

vi.mock('#/server/worktree-removal/physical-worktree-identity-resolver.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('#/server/worktree-removal/physical-worktree-identity-resolver.ts')>()
  class RuntimeTestPhysicalWorktreeResolver extends original.PhysicalWorktreeIdentityResolver {
    issue(input: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string; worktreePath: string }) {
      const remote = input.workspaceId.startsWith('goblin+ssh://')
      return this.issueCapability({
        ...input,
        identity: remote
          ? {
              kind: 'remote',
              executionNamespaceId: '0123456789abcdef0123456789abcdef',
              endpoint: input.worktreePath,
            }
          : { kind: 'local', executionNamespaceId: 'local', endpoint: input.worktreePath },
        execution: remote
          ? {
              kind: 'remote',
              canonicalWorktreePath: input.worktreePath,
              configFingerprint: 'terminal-runtime-test-config-fingerprint',
              target: {
                id: input.workspaceId,
                alias: 'prod',
                host: 'example.test',
                user: 'deploy',
                port: 22,
                remotePath: '/srv/repo',
                displayName: 'prod:repo',
              },
            }
          : {
              kind: 'local',
              canonicalWorktreePath: input.worktreePath,
            },
        runtimeSignal: new AbortController().signal,
      })
    }
  }
  const resolver = new RuntimeTestPhysicalWorktreeResolver({ onWorkspaceRuntimeClosed: () => () => undefined })
  return {
    ...original,
    createPhysicalWorktreeIdentityResolver: () => ({
      capture: vi.fn(
        async (input: { userId: string; workspaceId: WorkspaceId; workspaceRuntimeId: string; worktreePath: string }) =>
          resolver.issue(input),
      ),
      dispose: vi.fn(),
    }),
  }
})

export const mockPtys: Array<{
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: () => void
  setProcessName: (processName: string) => void
}> = []
let mockDataToEmitOnRegistration: string | null = null

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let onData: ((data: string) => void) | null = null
    let onExit: (() => void) | null = null
    let processName = 'zsh'
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => {
        queueMicrotask(() => onExit?.())
      }),
      emitData: (data: string) => onData?.(data),
      emitExit: () => onExit?.(),
      setProcessName: (nextProcessName: string) => {
        processName = nextProcessName
      },
      get process() {
        return processName
      },
    }
    mockPtys.push(pty)
    return {
      ...pty,
      get process() {
        return processName
      },
      onData: (cb: (data: string) => void) => {
        onData = cb
        if (mockDataToEmitOnRegistration !== null) {
          const data = mockDataToEmitOnRegistration
          mockDataToEmitOnRegistration = null
          cb(data)
        }
        return {
          dispose: vi.fn(() => {
            if (onData === cb) onData = null
          }),
        }
      },
      onExit: (cb: () => void) => {
        onExit = cb
        return {
          dispose: vi.fn(() => {
            if (onExit === cb) onExit = null
          }),
        }
      },
    }
  }),
}))

interface RuntimeHandle {
  host: ServerTerminalHost
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
  shutdown: () => void
  isClientOnline: (clientId: string) => boolean
}

const createTerminalApplications = new WeakMap<ServerTerminalHost, ServerWorkspacePaneRuntimeHost>()
const activeRuntimeShutdowns = new Set<() => void>()
export let testWorkspacePaneLayout: WorkspacePaneDurableLayout = { entries: [] }
export let testWorkspacePaneLayoutWriteError: Error | null = null

export function setWorkspaceRuntimeId(workspaceRuntimeId: string): void {
  WORKSPACE_RUNTIME_ID = workspaceRuntimeId
}

export function setMockDataToEmitOnRegistration(data: string | null): void {
  mockDataToEmitOnRegistration = data
}

export function setTestWorkspacePaneLayout(layout: WorkspacePaneDurableLayout): void {
  testWorkspacePaneLayout = layout
}

export function setTestWorkspacePaneLayoutWriteError(error: Error | null): void {
  testWorkspacePaneLayoutWriteError = error
}

const testWorkspacePaneLayoutRepository: WorkspacePaneLayoutRepository = {
  async load() {
    return { layout: structuredClone(testWorkspacePaneLayout) }
  },
  async compareAndSwap(input) {
    if (testWorkspacePaneLayoutWriteError) return { kind: 'write-failure', error: testWorkspacePaneLayoutWriteError }
    if (JSON.stringify(testWorkspacePaneLayout) !== JSON.stringify(input.expected)) {
      return { kind: 'conflict', snapshot: { layout: structuredClone(testWorkspacePaneLayout) } }
    }
    const changed = JSON.stringify(testWorkspacePaneLayout) !== JSON.stringify(input.replacement)
    testWorkspacePaneLayout = structuredClone(input.replacement)
    return { kind: 'accepted', changed, snapshot: { layout: structuredClone(testWorkspacePaneLayout) } }
  },
}

export function buildRuntime(
  options: {
    captureTargets?: WorkspacePaneTargetProjectionProvider['captureTargets']
  } = {},
): RuntimeHandle {
  const runtime = createServerTerminalRuntime({
    ptySupervisor: createInProcessPtySupervisor(),
    workspacePaneLayoutRepository: testWorkspacePaneLayoutRepository,
    workspacePaneTargetProjection: {
      captureTargets:
        options.captureTargets ??
        (async (_userId, repoRoot, scope) => {
          const workspaceId = canonicalWorkspaceLocator(repoRoot)
          if (!workspaceId) throw new Error('invalid test workspace id')
          const separator = scope.lastIndexOf('\0')
          const workspaceRuntimeId = scope.slice(separator + 1)
          const nativeWorktreePath = repoRoot.startsWith('goblin+ssh://') ? '/srv/repo' : '/repo-linked'
          return [
            {
              target: {
                kind: 'git-worktree',
                workspaceId,
                workspaceRuntimeId,
                root: repoRoot.startsWith('goblin+ssh://') ? workspaceId : LINKED_REPO_ROOT,
              },
              nativeWorktreePath,
              canonicalBranch: 'feature',
            },
          ]
        }),
    },
  })
  WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_a')
  const sshWorkspaceId = workspaceIdForTest('goblin+ssh://prod/srv/repo')
  SSH_WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_1, sshWorkspaceId, 'client_a')
  USER_2_WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_2, REPO_ROOT, 'client_b')
  const user2SshWorkspaceRuntimeId = acquireWorkspaceRuntime(USER_2, sshWorkspaceId, 'client_b')
  commitTerminalReadyProbe(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID)
  commitTerminalReadyProbe(USER_1, sshWorkspaceId, SSH_WORKSPACE_RUNTIME_ID)
  commitTerminalReadyProbe(USER_2, REPO_ROOT, USER_2_WORKSPACE_RUNTIME_ID)
  commitTerminalReadyProbe(USER_2, sshWorkspaceId, user2SshWorkspaceRuntimeId)
  createTerminalApplications.set(runtime.host, runtime.workspacePaneRuntimeHost)
  const shutdown = () => {
    if (!activeRuntimeShutdowns.delete(shutdown)) return
    runtime.shutdown()
  }
  activeRuntimeShutdowns.add(shutdown)
  return {
    host: runtime.host,
    workspaceCapabilityTransitionHost: runtime.workspaceCapabilityTransitionHost,
    shutdown,
    isClientOnline: (clientId: string) => runtime.host.isClientOnline(USER_1, clientId),
  }
}

beforeEach(() => {
  vi.useRealTimers()
  mockPtys.length = 0
  mockDataToEmitOnRegistration = null
  testWorkspacePaneLayout = { entries: [] }
  testWorkspacePaneLayoutWriteError = null
  vi.clearAllMocks()
  clearWorkspaceRuntimesForUser(USER_1)
  clearWorkspaceRuntimesForUser(USER_2)
})

afterEach(() => {
  for (const shutdown of Array.from(activeRuntimeShutdowns)) shutdown()
})

export function sentSocketMessages(socket: {
  send: ReturnType<typeof vi.fn>
}): Array<{ type?: string; [key: string]: unknown }> {
  return socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
}

export function appRealtimeSocket(send = vi.fn()) {
  return { bufferedAmount: 0, send, close: vi.fn(), terminate: vi.fn() }
}

export async function requestWorkspacePaneTabs(
  host: ServerTerminalHost,
  socket: ReturnType<typeof appRealtimeSocket>,
  action: string,
  input: unknown,
  requestId: string,
  identity: { clientId: string; userId: string } = { clientId: 'client_a', userId: USER_1 },
): Promise<unknown> {
  host.handleRealtimeMessage(
    identity.clientId,
    identity.userId,
    socket,
    JSON.stringify({
      type: 'request',
      requestId,
      action,
      input,
    }),
  )
  await vi.waitFor(() => {
    expect(
      sentSocketMessages(socket).some((message) => message.type === 'response' && message.requestId === requestId),
    ).toBe(true)
  })
  const response = sentSocketMessages(socket).find(
    (message) => message.type === 'response' && message.requestId === requestId,
  )
  expect(response).toMatchObject({ type: 'response', ok: true, action })
  return response?.payload
}

export async function requestWorkspacePaneRuntime(
  host: ServerTerminalHost,
  socket: ReturnType<typeof appRealtimeSocket>,
  input: WorkspacePaneRuntimeOpenInput,
  requestId: string,
): Promise<WorkspacePaneRuntimeOpenResult> {
  return (await requestWorkspacePaneTabs(
    host,
    socket,
    WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
    input,
    requestId,
  )) as WorkspacePaneRuntimeOpenResult
}

export async function createTerminalSession(
  host: ServerTerminalHost,
  clientId: string,
  userId = USER_1,
): Promise<string> {
  const result = await createLocalWorktreeTerminal(host, clientId, userId, 'additional')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  const attached = await host.attach(clientId, userId, {
    terminalRuntimeSessionId: result.terminalRuntimeSessionId,
    terminalRuntimeGeneration: 0,
    cols: 80,
    rows: 24,
  })
  if (!attached.ok) throw new Error(attached.message)
  expect(attached).toMatchObject({ frame: 'stream' })
  return result.terminalRuntimeSessionId
}

export function createLocalWorktreeTerminal(
  host: ServerTerminalHost,
  clientId: string,
  userId: string,
  kind: TerminalCreateInput['kind'],
) {
  return createAdmittedTerminal(host, clientId, userId, {
    repoRoot: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind,
  })
}

export async function startControlledTerminalRuntime() {
  const { host, shutdown } = buildRuntime()
  const socket = appRealtimeSocket()
  host.registerSocket('client_a', USER_1, socket)
  const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')
  return { host, shutdown, socket, terminalRuntimeSessionId }
}

export async function createAdmittedTerminal(
  host: ServerTerminalHost,
  clientId: string,
  userId: string,
  input: TerminalCreateFixtureInput,
): Promise<TerminalCreateResult> {
  const application = createTerminalApplications.get(host)
  if (!application) throw new Error('missing workspace pane runtime application')
  const request: TerminalCreateInput = {
    kind: input.kind,
    ...(input.startupShellCommand ? { startupShellCommand: input.startupShellCommand } : {}),
    target: input.target ?? terminalCreateTarget(input),
  }
  acquireWorkspaceRuntime(userId, request.target.workspaceId, clientId)
  const result = await application.openRuntime(clientId, userId, {
    runtimeType: 'terminal',
    request,
  })
  return result.ok ? result.runtime : { ok: false, message: result.message }
}

interface TerminalCreateFixtureInput extends Omit<TerminalCreateInput, 'target'> {
  repoRoot: string
  workspaceRuntimeId: string
  branch: string
  worktreePath: string
  target?: TerminalCreateInput['target']
}

function terminalCreateTarget(
  input: Pick<TerminalCreateFixtureInput, 'repoRoot' | 'workspaceRuntimeId' | 'worktreePath'>,
) {
  const workspaceId = requiredWorkspaceLocator(input.repoRoot)
  const root = input.repoRoot.startsWith('goblin+ssh://')
    ? workspaceId
    : requiredWorkspaceLocator(`goblin+file://${input.worktreePath}`)
  return { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: input.workspaceRuntimeId, root }
}
