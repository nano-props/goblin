// Server-side terminal runtime integration tests.
//
// The lower-level modules (session-manager, controller, render-state,
// broker, session service) carry their own focused unit tests. This file
// exercises `createServerTerminalRuntime` end-to-end through its
// `ServerTerminalHost` surface so the wiring between the supervisor,
// manager, broker, and session service stays in lockstep with the shared
// protocol types in `shared/terminal-types.ts`.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  acquireWorkspaceRuntime,
  clearWorkspaceRuntimesForUser,
  closeWorkspaceRuntimesForDurableRemoval,
  commitWorkspaceProbeState,
  releaseWorkspaceRuntime,
} from '#/server/modules/workspace-runtimes.ts'
import { getWorktrees } from '#/system/git/worktrees.ts'
import { resolveRemoteTarget } from '#/system/ssh/config.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { HEARTBEAT_DEADLINE_MS, HEARTBEAT_INTERVAL_MS } from '#/server/terminal/terminal-realtime-broker.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import type { TerminalCreateInput, TerminalCreateResult } from '#/shared/terminal-types.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  WORKSPACE_PANE_TABS_REALTIME_EVENTS,
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
} from '#/shared/workspace-pane-tabs.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeOpenInput,
  type WorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime.ts'
import { advanceTimersAndFlush, useFakeTimers } from '#/test-utils/timers.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
// Under method 2 the host threads `userId` (derived from the
// access token) alongside `clientId` (per-page routing). Tests use
// a fixed value so the assertions don't have to mock the
// derivation helper.
const USER_1 = 'user_terminal_runtime'
const USER_2 = 'user_terminal_runtime_second'
const REPO_ROOT = requiredWorkspaceLocator('goblin+file:///repo')
const LINKED_REPO_ROOT = requiredWorkspaceLocator('goblin+file:///repo-linked')
let WORKSPACE_RUNTIME_ID = ''
let SSH_WORKSPACE_RUNTIME_ID = ''
let USER_2_WORKSPACE_RUNTIME_ID = ''
const TEST_NOW = new Date('2026-06-24T00:00:00Z')
const DETACHED_TTL_MS = 24 * 60 * 60 * 1000
const CLIENT_STATE_GRACE_MS = 30_000
const HEARTBEAT_SILENCE_MS = HEARTBEAT_DEADLINE_MS

function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

function workspacePaneTabsListInput(workspaceRuntimeId: string) {
  return { workspaceId: REPO_ROOT, workspaceRuntimeId }
}

function workspacePaneWorktreeTarget(workspaceRuntimeId: string) {
  return {
    kind: 'git-worktree' as const,
    workspaceId: REPO_ROOT,
    workspaceRuntimeId,
    root: LINKED_REPO_ROOT,
  }
}

function commitTerminalReadyProbe(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): void {
  const committed = commitWorkspaceProbeState({
    userId,
    workspaceId,
    workspaceRuntimeId,
    probe: {
      status: 'ready',
      name: 'Mock workspace',
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
  getWorktrees: vi.fn(async () => [{ path: '/repo-linked', branch: 'feature', isBare: false, isPrimary: false }]),
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
              endpointMarker: { deviceId: '10', inode: '20' },
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
              endpointMarker: { deviceId: 'test-device', inode: 'test-inode' },
            },
        runtimeSignal: new AbortController().signal,
        validateExecution: async () => undefined,
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

const mockPtys: Array<{
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
let testWorkspacePaneLayout: WorkspacePaneDurableLayout = { entries: [] }
let testWorkspacePaneLayoutWriteError: Error | null = null
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

function buildRuntime(
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

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

async function flushPromiseQueue(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function sentSocketMessages(socket: {
  send: ReturnType<typeof vi.fn>
}): Array<{ type?: string; [key: string]: unknown }> {
  return socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
}

async function requestWorkspacePaneTabs(
  host: ServerTerminalHost,
  socket: { send: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> },
  action: string,
  input: unknown,
  requestId: string,
  identity: { clientId: string; userId: string } = { clientId: 'client_a', userId: USER_1 },
): Promise<unknown> {
  host.handleRealtimeMessage(
    identity.clientId,
    identity.userId,
    socket as Parameters<ServerTerminalHost['handleRealtimeMessage']>[2],
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

async function requestWorkspacePaneRuntime(
  host: ServerTerminalHost,
  socket: { send: ReturnType<typeof vi.fn>; close?: ReturnType<typeof vi.fn> },
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

async function createTerminalSession(host: ServerTerminalHost, clientId: string, userId = USER_1): Promise<string> {
  const result = await createAdmittedTerminal(host, clientId, userId, {
    repoRoot: REPO_ROOT,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    branch: 'feature',
    worktreePath: '/repo-linked',
    kind: 'additional',
    cols: 80,
    rows: 24,
    ...(clientId ? { clientId } : {}),
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  const attached = await host.attach(clientId, userId, {
    terminalRuntimeSessionId: result.terminalRuntimeSessionId,
    cols: 80,
    rows: 24,
    ...(clientId ? { clientId } : {}),
  })
  expect(attached).toMatchObject({ ok: true, frame: 'stream' })
  return result.terminalRuntimeSessionId
}

async function createAdmittedTerminal(
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
    ...(input.cols === undefined ? {} : { cols: input.cols }),
    ...(input.rows === undefined ? {} : { rows: input.rows }),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    target: input.target ?? terminalCreateTarget(input),
  }
  acquireWorkspaceRuntime(userId, request.target.workspaceId, clientId)
  const result = await application.openRuntime(clientId, userId, {
    runtimeType: 'terminal',
    request: request.clientId ? request : { ...request, clientId },
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

describe('server terminal runtime', () => {
  test('opens a Git terminal from one target-catalog capture', async () => {
    const captureTargets = vi.fn(
      async (...args: Parameters<WorkspacePaneTargetProjectionProvider['captureTargets']>) => {
        const scope = args[2]
        return [
          {
            target: workspacePaneWorktreeTarget(scope.slice(scope.lastIndexOf('\0') + 1)),
            nativeWorktreePath: '/repo-linked',
            canonicalBranch: 'feature',
          },
        ]
      },
    )
    const { host, shutdown } = buildRuntime({ captureTargets })
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    await expect(
      requestWorkspacePaneRuntime(
        host,
        socket,
        {
          runtimeType: 'terminal',
          request: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            kind: 'additional',
            cols: 80,
            rows: 24,
          },
        },
        'req_open_single_catalog_capture',
      ),
    ).resolves.toMatchObject({ ok: true })
    expect(captureTargets).toHaveBeenCalledOnce()

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('create claims controller control for the provided attachment', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const result = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({
      terminalSessionId: result.terminalSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      phase: 'opening',
      message: null,
      canonicalCols: 80,
      canonicalRows: 24,
    })
    expect(result).not.toHaveProperty('sessions')
    const terminalRuntimeSessionId = result.terminalRuntimeSessionId

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        phase: 'opening',
        message: null,
      }),
    ])
    expect(mockPtys).toHaveLength(0)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('application create and fresh binding activation both invalidate terminal sessions', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const result = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })

    expect(result.ok).toBe(true)
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
    ])
    expect(
      sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
    ).toBe(true)
    if (!result.ok) return

    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId: result.terminalRuntimeSessionId,
        cols: 80,
        rows: 24,
        clientId: 'client_a',
      }),
    ).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      terminalProjectionEffect: { kind: 'delta', revision: 2 },
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 2 },
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a second attachment can attach as viewer without stealing controller control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)

    const createResult = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        cols: 80,
        rows: 24,
        clientId: 'client_a',
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })

    const attachResult = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(attachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 80,
      canonicalRows: 24,
    })

    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('replay snapshots omit a leading zsh prompt end marker prelude', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    const prompt =
      '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m                                                                            \r \r\r\x1b[0m\x1b[27m\x1b[24m\x1b[J👾:~/repo\r\n$ '
    mockPtys[0]?.emitData(prompt)

    const attach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(attach.ok).toBe(true)
    if (!attach.ok || attach.frame !== 'snapshot') return
    expect(attach.snapshot).toBe('👾:~/repo\r\n$ ')
    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reattaching after presence goes offline auto-reclaims control and canonical geometry', async () => {
    // The previous revision had a 30s grace sub-state that kept the
    // controller role occupied between offline and online transitions. The
    // current model keeps controller intent but derives the effective
    // controller from broker presence, so a reattach can reclaim with
    // fresh geometry when no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)

    const createResult = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId

    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        cols: 80,
        rows: 24,
        clientId: 'client_a',
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })

    host.unregisterSocket('client_a', USER_1, socketA)
    const socketA2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA2)

    const reattachResult = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 101,
      rows: 31,
      clientId: 'client_a',
    })
    expect(reattachResult).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_a', status: 'connected' },
      canonicalCols: 101,
      canonicalRows: 31,
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(101, 31)

    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 101,
        rows: 31,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA2)
    shutdown()
  })

  test('realtime attach injects the socket clientId and resizes an owned session to the live terminal size', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    const createResult = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return
    const terminalRuntimeSessionId = createResult.terminalRuntimeSessionId
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach_resize',
        action: 'attach',
        input: { terminalRuntimeSessionId, cols: 101, rows: 31, clientId: 'client_a' },
      }),
    )

    await vi.waitFor(() => {
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const response = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'response' && message.requestId === 'req_attach_resize')
    expect(response).toMatchObject({
      type: 'response',
      requestId: 'req_attach_resize',
      ok: true,
      action: 'attach',
      payload: {
        ok: true,
        frame: 'stream',
        terminalRuntimeSessionId,
        phase: 'open',
        message: null,
        canonicalCols: 101,
        canonicalRows: 31,
        controller: { clientId: 'client_a', status: 'connected' },
      },
    })
    expect(mockPtys[0]?.resize).not.toHaveBeenCalled()

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('broadcasts output, title, bell, and exit events to registered web terminal sockets', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    mockPtys[0]?.emitData('hello')
    const outputMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'output')
    expect(outputMessage).toMatchObject({
      type: 'output',
      event: { terminalRuntimeSessionId, terminalSessionId: expect.any(String), data: 'hello', outputEra: 0, seq: 1 },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b]0;build running\x07done\x07')
    const bellMessage = sentSocketMessages(socket).find((message) => message.type === 'bell')
    expect(bellMessage).toMatchObject({
      type: 'bell',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        processName: 'zsh',
        canonicalTitle: 'build running',
      },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b[22;0t\x1b]0;devin: hello\x07\x1b]30;devin: hello\x07')
    const devinTitleMessage = sentSocketMessages(socket).find((message) => message.type === 'title')
    expect(devinTitleMessage).toMatchObject({
      type: 'title',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        canonicalTitle: 'devin: hello',
      },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x07\x1b]0;after bell\x07')
    const bellThenTitleMessages = sentSocketMessages(socket)
    expect(bellThenTitleMessages.map((message) => message.type)).toEqual(['bell', 'title', 'output'])
    expect(bellThenTitleMessages[0]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, canonicalTitle: 'devin: hello' },
    })
    expect(bellThenTitleMessages[1]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'after bell' },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x1b]0;first\x07\x07\x1b]0;second\x07')
    const titleBellTitleMessages = sentSocketMessages(socket)
    expect(titleBellTitleMessages.map((message) => message.type)).toEqual(['title', 'bell', 'title', 'output'])
    expect(titleBellTitleMessages[0]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'first' },
    })
    expect(titleBellTitleMessages[1]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, canonicalTitle: 'first' },
    })
    expect(titleBellTitleMessages[2]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'second' },
    })

    socket.send.mockClear()
    mockPtys[0]?.emitData('\x9d2;devin running\x9c')
    const titleMessage = sentSocketMessages(socket).find((message) => message.type === 'title')
    expect(titleMessage).toMatchObject({
      type: 'title',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        canonicalTitle: 'devin running',
      },
    })

    mockPtys[0]?.emitExit()
    const exitMessage = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'exit')
    expect(exitMessage).toMatchObject({
      type: 'exit',
      event: {
        terminalRuntimeSessionId,
        terminalSessionId: expect.any(String),
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      },
    })
    expect(host.getDiagnostics().terminal.pty.state).toBe('idle')

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('clears stale title on non-shell to shell transition before emitting same-chunk bell', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    mockPtys[0]?.setProcessName('vim')
    mockPtys[0]?.emitData('\x1b]0;vim editing\x07')
    expect(sentSocketMessages(socket).find((message) => message.type === 'title')).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: 'vim editing' },
    })

    socket.send.mockClear()
    mockPtys[0]?.setProcessName('zsh')
    mockPtys[0]?.emitData('\x07$ ')
    const messages = sentSocketMessages(socket)
    expect(messages.map((message) => message.type)).toEqual(['title', 'bell', 'output'])
    expect(messages[0]).toMatchObject({
      type: 'title',
      event: { terminalRuntimeSessionId, canonicalTitle: null },
    })
    expect(messages[1]).toMatchObject({
      type: 'bell',
      event: { terminalRuntimeSessionId, processName: 'zsh', canonicalTitle: null },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reconciles workspace tabs when a PTY exits naturally', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          kind: 'additional',
          cols: 80,
          rows: 24,
        },
      },
      'req_open_terminal_before_exit',
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId: opened.runtime.terminalRuntimeSessionId,
        cols: 80,
        rows: 24,
        clientId: 'client_a',
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    socket.send.mockClear()

    mockPtys[0]?.emitExit()

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        'req_list_after_exit',
      ),
    ).resolves.toMatchObject({ entries: [] })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('reconciles workspace tabs when prune closes removed-worktree sessions', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          kind: 'additional',
          cols: 80,
          rows: 24,
        },
      },
      'req_open_terminal_before_prune',
    )
    expect(opened.ok).toBe(true)
    socket.send.mockClear()
    vi.mocked(getWorktrees).mockResolvedValueOnce([])

    await expect(
      host.prune('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual({ pruned: 1, remaining: 0 })

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        'req_list_after_prune',
      ),
    ).resolves.toMatchObject({ entries: [] })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('realtime workspace pane tabs replace materializes missing terminal tabs and list returns canonical tabs', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
        {
          ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
        },
        'req_replace_workspace_tabs',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'terminal', runtimeSessionId: created.terminalSessionId },
          ],
        },
      ],
    })
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_list_workspace_tabs',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        input: workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
      }),
    )

    await vi.waitFor(() => {
      const messages = sentSocketMessages(socket)
      expect(
        messages.some((message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs'),
      ).toBe(true)
    })
    const response = sentSocketMessages(socket).find(
      (message) => message.type === 'response' && message.requestId === 'req_list_workspace_tabs',
    )
    expect(response).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      payload: {
        revision: expect.any(Number),
        entries: [
          {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            tabs: [
              { type: 'status', tabId: 'workspace-pane:status' },
              { type: 'terminal', runtimeSessionId: created.terminalSessionId },
            ],
          },
        ],
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('broadcasts an accepted durable pane layout change to every active user projection', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_2, socketB)

    await requestWorkspacePaneTabs(
      host,
      socketA,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
      'req_list_user_a',
    )
    await requestWorkspacePaneTabs(
      host,
      socketB,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
      workspacePaneTabsListInput(USER_2_WORKSPACE_RUNTIME_ID),
      'req_list_user_b',
      { clientId: 'client_b', userId: USER_2 },
    )
    socketA.send.mockClear()
    socketB.send.mockClear()

    await requestWorkspacePaneTabs(
      host,
      socketA,
      WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
      {
        ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
        operation: { type: 'open-static', tabType: 'history' },
      },
      'req_update_user_a',
    )

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socketA).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
      expect(
        sentSocketMessages(socketB).some((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toBe(true)
    })

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_2, socketB)
    shutdown()
  })

  test('unregisters a buffered socket when raw send fails during broadcast', async () => {
    const { host, shutdown, isClientOnline } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    await createTerminalSession(host, 'client_a')
    socket.send.mockImplementation(() => {
      throw new Error('socket closed')
    })

    mockPtys[0]?.emitData('hello')

    expect(host.getDiagnostics().terminal.registeredSockets).toBe(0)
    expect(isClientOnline('client_a')).toBe(false)
    shutdown()
  })

  test('returns created terminal sessions for SSH remote repositories', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: 'goblin+ssh://prod/srv/repo',
      workspaceRuntimeId: SSH_WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/srv/repo',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(resolveRemoteTarget).not.toHaveBeenCalled()
    expect(result.terminalSessionId).toMatch(/^term-[A-Za-z0-9_-]{21}$/)
    expect(result).not.toHaveProperty('sessions')
    await expect(
      host.listSessions('client_a', USER_1, {
        workspaceId: requiredWorkspaceLocator('goblin+ssh://prod/srv/repo'),
        workspaceRuntimeId: SSH_WORKSPACE_RUNTIME_ID,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        terminalSessionId: result.terminalSessionId,
        target: expect.objectContaining({
          kind: 'git-worktree',
          workspaceId: requiredWorkspaceLocator('goblin+ssh://prod/srv/repo'),
          root: 'goblin+ssh://prod/srv/repo',
        }),
      }),
    ])

    shutdown()
  })

  test('reuses the existing terminal when reopening the same repo root', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.action).toBe('created')
    const second = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('reused')
    expect(second.terminalSessionId).toBe(first.terminalSessionId)

    shutdown()
  })

  test('workspace runtime close drops runtime state while preserving durable layout for the reopened epoch', async () => {
    const { host, shutdown } = buildRuntime()
    const first = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
        {
          ...workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          operation: { type: 'open-static', tabType: 'history' },
        },
        'req_update_before_repo_close',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'terminal', runtimeSessionId: first.terminalSessionId },
            { type: 'history', tabId: 'workspace-pane:history' },
          ],
        },
      ],
    })
    socket.send.mockClear()

    expect(closeWorkspaceRuntimesForDurableRemoval(REPO_ROOT)).toBe(2)
    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).filter((message) => message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed),
      ).toHaveLength(1)
    })
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toHaveLength(1)
    const nextWorkspaceRuntimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_a')
    commitTerminalReadyProbe(USER_1, REPO_ROOT, nextWorkspaceRuntimeId)

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: nextWorkspaceRuntimeId }),
    ).resolves.toEqual([])
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(nextWorkspaceRuntimeId),
        'req_list_after_repo_reopen',
      ),
    ).resolves.toMatchObject({
      entries: [
        {
          target: workspacePaneWorktreeTarget(nextWorkspaceRuntimeId),
          tabs: [
            { type: 'status', tabId: 'workspace-pane:status' },
            { type: 'history', tabId: 'workspace-pane:history' },
          ],
        },
      ],
    })

    const second = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: nextWorkspaceRuntimeId,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.action).toBe('created')
    expect(second.terminalSessionId).not.toBe(first.terminalSessionId)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('Git capability removal clears Git-scoped sessions and durable layout without replacing the runtime', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    testWorkspacePaneLayout = {
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    }

    await expect(
      workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
        userId: USER_1,
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({ kind: 'committed' })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('Git capability cleanup preserves runtime resources when durable layout commit fails', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(created.ok).toBe(true)
    testWorkspacePaneLayout = {
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    }
    testWorkspacePaneLayoutWriteError = new Error('layout write failed')

    const result = await workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
    })

    expect(result).toEqual({ kind: 'failed-before-commit', error: testWorkspacePaneLayoutWriteError })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toHaveLength(1)
    expect(testWorkspacePaneLayout.entries).toHaveLength(1)
    shutdown()
  })

  test('capability cleanup fast-fails once before its durable transaction', async () => {
    const { workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    testWorkspacePaneLayout = {
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    }
    let checks = 0
    await workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {
        checks += 1
        if (checks > 1) throw new Error('error.workspace-runtime-stale')
      },
    })

    expect(checks).toBe(1)
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('Git capability removal commit is idempotent', async () => {
    const { host, workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(created.ok).toBe(true)
    testWorkspacePaneLayout = {
      entries: [
        {
          target: { kind: 'git-worktree', root: LINKED_REPO_ROOT },
          tabs: [workspacePaneStaticTabEntry('files')],
        },
      ],
    }
    const input = {
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
    }

    await expect(workspaceCapabilityTransitionHost.commitGitCapabilityRemoval(input)).resolves.toEqual({
      kind: 'committed',
    })
    await expect(workspaceCapabilityTransitionHost.commitGitCapabilityRemoval(input)).resolves.toEqual({
      kind: 'committed',
    })

    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])
    expect(testWorkspacePaneLayout).toEqual({ entries: [] })
    shutdown()
  })

  test('does not schedule deferred capability effects after runtime shutdown', async () => {
    const { workspaceCapabilityTransitionHost, shutdown } = buildRuntime()
    const pending = workspaceCapabilityTransitionHost.commitGitCapabilityRemoval({
      userId: USER_1,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      assertCurrent: () => {},
    })

    shutdown()
    await expect(pending).resolves.toEqual({ kind: 'committed' })
    await Promise.resolve()
  })

  test('serializes concurrent primary creates for the same worktree', async () => {
    const { host, shutdown } = buildRuntime()

    const first = createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    const second = createAdmittedTerminal(host, 'client_b', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })

    const firstResult = await first
    expect(firstResult.ok).toBe(true)
    if (!firstResult.ok) return
    expect(firstResult.action).toBe('created')

    const secondResult = await second
    expect(secondResult.ok).toBe(true)
    if (!secondResult.ok) return
    expect(secondResult.action).toBe('reused')
    expect(secondResult.terminalSessionId).toBe(firstResult.terminalSessionId)
    expect(secondResult.terminalRuntimeSessionId).toBe(firstResult.terminalRuntimeSessionId)
    expect(mockPtys).toHaveLength(0)

    shutdown()
  })

  test('reopening an existing terminal from a new attachment auto-reclaims user-sticky control', async () => {
    const { host, shutdown } = buildRuntime()
    const browserSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_browser', USER_1, browserSocket)

    const first = await createAdmittedTerminal(host, 'client_browser', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
      clientId: 'client_browser',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.controller).toEqual({ clientId: 'client_browser', status: 'connected' })

    host.unregisterSocket('client_browser', USER_1, browserSocket)

    const electronSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_electron', USER_1, electronSocket)

    const reopened = await createAdmittedTerminal(host, 'client_electron', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 102,
      rows: 33,
      clientId: 'client_electron',
    })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.action).toBe('reused')
    expect(reopened.terminalSessionId).toBe(first.terminalSessionId)
    expect(reopened.controller).toEqual({ clientId: 'client_electron', status: 'connected' })
    expect(reopened.canonicalCols).toBe(80)
    expect(reopened.canonicalRows).toBe(24)
    await expect(
      host.attach('client_electron', USER_1, {
        terminalRuntimeSessionId: reopened.terminalRuntimeSessionId,
        cols: 102,
        rows: 33,
        clientId: 'client_electron',
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream', canonicalCols: 102, canonicalRows: 33 })

    const sessions = await host.listSessions('client_electron', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: first.terminalSessionId,
        controller: { clientId: 'client_electron', status: 'connected' },
        cols: 102,
        rows: 33,
      }),
    ])

    host.unregisterSocket('client_electron', USER_1, electronSocket)
    shutdown()
  })

  test('a failed first attach keeps the prepared session addressable for retry', async () => {
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty spawn failed')
    })
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    socket.send.mockClear()

    const failed = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(failed.ok).toBe(true)
    if (!failed.ok) return
    const failedAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId: failed.terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(failedAttach).toEqual({ ok: false, message: 'pty spawn failed' })

    // Process creation failure is lifecycle state on the logical session;
    // the durable tab remains addressable so an explicit retry can recover.
    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: failed.terminalRuntimeSessionId,
        phase: 'error',
        message: 'pty spawn failed',
      }),
    ])
    expect(sentSocketMessages(socket).filter((message) => message.type === 'sessions-changed')).toEqual([
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 1 },
      { type: 'sessions-changed', workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID, revision: 2 },
    ])

    // A never-spawned session has no exit event — lock in that
    // semantic so we don't regress to broadcasting a phantom exit.
    const exitBroadcasts = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'exit')
    expect(exitBroadcasts).toEqual([])

    // Reopening reuses the same logical session; the next attach owns the
    // next process attempt.
    const retried = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(retried.ok).toBe(true)
    if (retried.ok) {
      expect(retried.action).toBe('restored')
      expect(retried.terminalRuntimeSessionId).toBe(failed.terminalRuntimeSessionId)
      await expect(
        host.attach('client_a', USER_1, {
          terminalRuntimeSessionId: retried.terminalRuntimeSessionId,
          cols: 80,
          rows: 24,
          clientId: 'client_a',
        }),
      ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    }

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a failed restart keeps the session visible as error state', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')

    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(restarted.ok).toBe(false)
    if (restarted.ok) return
    expect(restarted.message).toBe('pty restart failed')

    const sessionsAfterFailure = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterFailure).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        phase: 'error',
        message: 'pty restart failed',
        cols: 100,
        rows: 30,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('a viewer cannot restart a session it does not control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const restarted = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_b',
    })
    expect(restarted.ok).toBe(false)
    if (!restarted.ok) return
    expect(restarted.message).toBe('error.not-controller')

    // Stored controller intent still points at `client_a`, and `client_a`
    // is the effective controller; a subsequent restart from that client
    // must pass the authority check (here it fails later at spawn).
    const { spawn } = await import('node-pty')
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('pty restart failed')
    })
    const retry = await host.restart('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(retry.ok).toBe(false)
    if (retry.ok) return
    expect(retry.message).toBe('pty restart failed')

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('drops buffered output covered by the attach response snapshot', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    mockPtys[0]?.emitData('before-attach')
    socket.send.mockClear()

    host.handleRealtimeMessage(
      'client_1',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_attach',
        action: 'attach',
        input: { terminalRuntimeSessionId, cols: 80, rows: 24 },
      }),
    )
    await vi.waitFor(() => {
      expect(socket.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const messages = socket.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex((message) => message.type === 'response')
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(messages[responseIndex]).toMatchObject({
      type: 'response',
      requestId: 'req_attach',
      ok: true,
      action: 'attach',
      payload: {
        ok: true,
        snapshot: expect.stringContaining('before-attach'),
        snapshotSeq: 1,
      },
    })
    expect(messages.some((message) => message.type === 'output')).toBe(false)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('runtime-open returns prepared terminal metadata and canonical tabs without starting a PTY', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    mockDataToEmitOnRegistration = 'during-runtime-open'

    host.handleRealtimeMessage(
      'client_a',
      USER_1,
      socket,
      JSON.stringify({
        type: 'request',
        requestId: 'req_runtime_open',
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        input: {
          runtimeType: 'terminal',
          insertAfterIdentity: 'workspace-pane:status',
          request: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
            kind: 'primary',
            cols: 80,
            rows: 24,
            clientId: 'forged_client',
          },
        },
      }),
    )

    await vi.waitFor(() => {
      expect(
        sentSocketMessages(socket).some(
          (message) => message.type === 'response' && message.requestId === 'req_runtime_open',
        ),
      ).toBe(true)
    })

    const messages = sentSocketMessages(socket)
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_runtime_open',
    )
    expect(messages[responseIndex]).toMatchObject({
      type: 'response',
      ok: true,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      payload: {
        ok: true,
        runtimeType: 'terminal',
        runtime: {
          ok: true,
          action: 'created',
          controller: { clientId: 'client_a', status: 'connected' },
        },
      },
    })
    expect(mockPtys).toHaveLength(0)
    expect(messages.filter((message) => message.type === 'output')).toHaveLength(0)
    const firstRealtimeIndex = messages.findIndex(
      (message) => message.type === 'sessions-changed' || message.type === WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
    )
    expect(firstRealtimeIndex).toBeGreaterThan(responseIndex)

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('runtime-close resolves durable terminal identity on the server and returns a canonical snapshot', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const opened = await requestWorkspacePaneRuntime(
      host,
      socket,
      {
        runtimeType: 'terminal',
        request: {
          target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          kind: 'additional',
          cols: 80,
          rows: 24,
        },
      },
      'req_runtime_open_before_close',
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        {
          runtimeType: 'terminal',
          sessionId: opened.runtime.terminalSessionId,
          target: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          },
        },
        'req_runtime_close',
      ),
    ).resolves.toMatchObject({
      ok: true,
      runtimeType: 'terminal',
      runtime: {
        action: 'closed',
        terminalSessionId: opened.runtime.terminalSessionId,
        terminalRuntimeSessionId: opened.runtime.terminalRuntimeSessionId,
      },
    })
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket,
        WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close,
        {
          runtimeType: 'terminal',
          sessionId: opened.runtime.terminalSessionId,
          target: {
            target: workspacePaneWorktreeTarget(WORKSPACE_RUNTIME_ID),
          },
        },
        'req_runtime_close_again',
      ),
    ).resolves.toMatchObject({
      ok: true,
      runtime: {
        action: 'already-closed',
        terminalSessionId: opened.runtime.terminalSessionId,
        terminalRuntimeSessionId: null,
      },
    })
    await expect(
      host.listSessions('client_a', USER_1, { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }),
    ).resolves.toEqual([])

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('rejects terminal IPC calls from untrusted senders', async () => {
    const { host, shutdown } = buildRuntime()
    const result = await createAdmittedTerminal(host, 'client_with_$pecial!chars' as never, USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'primary',
      cols: 80,
      rows: 24,
    })
    expect(result.ok).toBe(false)
    shutdown()
  })

  test('takeover returns authoritative controller snapshot from the server', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    host.registerSocket('client_b', USER_1, socketB)

    const result = host.takeover('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })

    expect(result).toEqual({
      ok: true,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 1,
      role: 'controller',
      controllerStatus: 'connected',
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
      phase: 'open',
    })
    expect(mockPtys[0]?.resize).toHaveBeenLastCalledWith(120, 40)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('realtime takeover injects the socket clientId so viewer tabs can take control', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_a')
    host.registerSocket('client_b', USER_1, socketB)
    socketB.send.mockClear()

    host.handleRealtimeMessage(
      'client_b',
      USER_1,
      socketB,
      JSON.stringify({
        type: 'request',
        requestId: 'req_takeover',
        action: 'takeover',
        input: { terminalRuntimeSessionId, cols: 120, rows: 40, clientId: 'client_b' },
      }),
    )

    await vi.waitFor(() => {
      expect(socketB.send.mock.calls.some(([payload]) => JSON.parse(String(payload)).type === 'response')).toBe(true)
    })

    const response = socketB.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .find((message) => message.type === 'response' && message.requestId === 'req_takeover')
    expect(response).toMatchObject({
      type: 'response',
      requestId: 'req_takeover',
      ok: true,
      action: 'takeover',
      payload: {
        ok: true,
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
      },
    })
    const messages = socketB.send.mock.calls.map(([payload]) => JSON.parse(String(payload)))
    const responseIndex = messages.findIndex(
      (message) => message.type === 'response' && message.requestId === 'req_takeover',
    )
    const identityIndex = messages.findIndex(
      (message) => message.type === 'identity' && message.event.terminalRuntimeSessionId === terminalRuntimeSessionId,
    )
    expect(responseIndex).toBeGreaterThanOrEqual(0)
    expect(identityIndex).toBeGreaterThan(responseIndex)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('lists repo sessions across clients sharing a userId and broadcasts lifecycle invalidations to that user', async () => {
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    host.registerSocket('client2_b', USER_1, socketB)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const result = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)

    acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_2')
    const sessions = await host.listSessions('client_2', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.terminalRuntimeSessionId).toBe(terminalRuntimeSessionId)

    expect(
      socketB.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.workspaceId === REPO_ROOT
      }),
    ).toBe(true)

    host.unregisterSocket('client_a', USER_1, socketA)
    host.unregisterSocket('client2_b', USER_1, socketB)
    shutdown()
  })

  test('isolates terminal session service reads and lifecycle broadcasts by userId', async () => {
    const { host, shutdown } = buildRuntime()
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_shared_attachment_a', USER_1, userASocket)
    host.registerSocket('client_shared_attachment_b', USER_2, userBSocket)

    const userACreate = await createAdmittedTerminal(host, 'client_shared', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(userACreate.ok).toBe(true)
    if (!userACreate.ok) return
    const userASession = {
      terminalRuntimeSessionId: userACreate.terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      terminalSessionId: userACreate.terminalSessionId,
    }

    acquireWorkspaceRuntime(USER_2, REPO_ROOT, 'client_shared')
    expect(
      await host.listSessions('client_shared', USER_2, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([])
    await expect(
      host.close('client_shared', USER_2, { terminalRuntimeSessionId: userASession.terminalRuntimeSessionId }),
    ).resolves.toBe(false)
    expect(
      userBSocket.send.mock.calls.some(([payload]) => {
        const parsed = JSON.parse(String(payload))
        return parsed.type === 'sessions-changed' && parsed.workspaceId === REPO_ROOT
      }),
    ).toBe(false)

    const userBCreate = await createAdmittedTerminal(host, 'client_shared', USER_2, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 100,
      rows: 30,
      clientId: 'client_b',
    })
    expect(userBCreate.ok).toBe(true)
    if (!userBCreate.ok) return
    const userBSession = {
      terminalRuntimeSessionId: userBCreate.terminalRuntimeSessionId,
      terminalRuntimeGeneration: 0,
      terminalSessionId: userBCreate.terminalSessionId,
    }

    expect(userBSession.terminalSessionId).not.toBe(userASession.terminalSessionId)
    expect(userBSession.terminalRuntimeSessionId).not.toBe(userASession.terminalRuntimeSessionId)
    expect(
      await host.listSessions('client_shared', USER_1, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userASession.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        terminalSessionId: userASession.terminalSessionId,
      }),
    ])
    expect(
      await host.listSessions('client_shared', USER_2, {
        workspaceId: REPO_ROOT,
        workspaceRuntimeId: USER_2_WORKSPACE_RUNTIME_ID,
      }),
    ).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: userBSession.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 0,
        terminalSessionId: userBSession.terminalSessionId,
      }),
    ])

    host.unregisterSocket('client_shared_attachment_a', USER_1, userASocket)
    host.unregisterSocket('client_shared_attachment_b', USER_2, userBSocket)
    shutdown()
  })

  test('cleans up detached user sessions after the detached TTL elapses', async () => {
    useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')

    const first = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(first.ok).toBe(true)
    expect(mockPtys).toHaveLength(1)

    host.unregisterSocket('client_a', USER_1, socket)
    await advanceTimersAndFlush(DETACHED_TTL_MS + 1)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    const socket2 = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_b', USER_1, socket2)
    WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_b')
    commitTerminalReadyProbe(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID)
    await expect(
      requestWorkspacePaneTabs(
        host,
        socket2,
        WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        workspacePaneTabsListInput(WORKSPACE_RUNTIME_ID),
        'req_list_after_detached_ttl',
        { clientId: 'client_b', userId: USER_1 },
      ),
    ).resolves.toMatchObject({ entries: [] })

    const recreatedSessionId = await createTerminalSession(host, 'client_1')
    const replacementAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId: recreatedSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_b',
    })
    expect(replacementAttach.ok).toBe(true)
    if (!first.ok || !replacementAttach.ok) return
    expect(replacementAttach.terminalRuntimeSessionId).not.toBe(first.terminalRuntimeSessionId)

    host.unregisterSocket('client_b', USER_1, socket2)
    shutdown()
  })

  test('after the controller goes offline, a sibling attachment auto-claims on attach (single-user)', async () => {
    // Device-switch scenario: A was the controller intent (from
    // create); A's socket closes, so A is no longer the effective
    // controller. B then attaches and auto-claims without explicit
    // takeover because no effective controller is present.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId

    host.unregisterSocket('client_a', USER_1, socketA)

    // B comes online and attaches — no explicit takeover needed
    // because A is no longer the effective controller.
    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      controller: { clientId: 'client_b', status: 'connected' },
      canonicalCols: 120,
      canonicalRows: 40,
    })

    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('a late-returning original controller stays a viewer once a sibling has claimed control (no grace restore)', async () => {
    // The user-sticky model keeps controller intent but derives
    // effective control from presence. If a sibling attachment
    // attaches while the original controller is offline, the sibling
    // claims control. When the original
    // controller eventually reconnects, it is a viewer — the
    // previous design's grace restore ("same clientId keeps
    // control after briefly going offline") does not apply. The
    // design-doc rule that wins here is "most recent write intent
    // wins" — the sibling's attach is the more recent intent.
    //
    // The client's AuthorityGate handles the recovery path: a
    // write from the late-returning attachment triggers a takeover
    // round-trip (asserted in the authority-gate tests). This
    // runtime test pins down the server-side state after the
    // reconnect so the contract is explicit.
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    const socketAReconnect = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId
    await expect(
      host.attach('client_a', USER_1, {
        terminalRuntimeSessionId,
        cols: 80,
        rows: 24,
        clientId: 'client_a',
      }),
    ).resolves.toMatchObject({ ok: true, frame: 'stream' })
    mockPtys[0]?.emitData('ready')

    // A goes offline; B attaches and claims because no effective controller remains.
    host.unregisterSocket('client_a', USER_1, socketA)
    host.registerSocket('client_b', USER_1, socketB)
    const bAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(bAttach).toMatchObject({
      ok: true,
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // A reconnects later. B still holds the controller role; A's attach must
    // NOT preempt B — A becomes a viewer.
    host.registerSocket('client_a', USER_1, socketAReconnect)
    const aReattach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(aReattach).toMatchObject({
      ok: true,
      terminalRuntimeSessionId,
      // A's view sees B still in control.
      controller: { clientId: 'client_b', status: 'connected' },
    })

    // And A's write is rejected — server-side authority check fails
    // with not-controller. The client-side AuthorityGate catches
    // this and fires a takeover before retrying; this test pins the
    // server invariant.
    const aWrite = await host.write('client_a', USER_1, {
      terminalRuntimeSessionId,
      data: 'ls\n',
      clientId: 'client_a',
    })
    expect(aWrite).toEqual({ status: 'rejected' })

    // B's write still works.
    const bWrite = await host.write('client_a', USER_1, {
      terminalRuntimeSessionId,
      data: 'pwd\n',
      clientId: 'client_b',
    })
    expect(bWrite).toEqual({ status: 'accepted' })
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    // listSessions confirms the global view: B is the controller,
    // canonical geometry follows B (the most recent writer).
    const sessions = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessions).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_b', status: 'connected' },
        cols: 120,
        rows: 40,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketAReconnect)
    host.unregisterSocket('client_b', USER_1, socketB)
    shutdown()
  })

  test('viewer presence going offline leaves the current controller unchanged', async () => {
    // The previous revision had a grace sub-state that, on expiry,
    // would remove the offline viewer via `expireAttachment`.
    // The current model has no per-attachment grace — only the
    // detached TTL fires (after 24h), which is far longer than the
    // test. The relevant invariant is that an offline viewer
    // doesn't disturb the controller.
    useFakeTimers()
    const { host, shutdown } = buildRuntime()
    const socketA = { send: vi.fn(), close: vi.fn() }
    const socketB = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socketA)
    const created = await createAdmittedTerminal(host, 'client_a', USER_1, {
      repoRoot: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branch: 'feature',
      worktreePath: '/repo-linked',
      kind: 'additional',
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const terminalRuntimeSessionId = created.terminalRuntimeSessionId

    host.registerSocket('client_b', USER_1, socketB)
    const viewerAttach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 120,
      rows: 40,
      clientId: 'client_b',
    })
    expect(viewerAttach.ok).toBe(true)

    host.unregisterSocket('client_b', USER_1, socketB)
    // The detached TTL is 24h — far longer than any grace we used
    // to have. Run a small tick to flush the socket-offline
    // microtask without firing any timer.
    await Promise.resolve()

    const sessionsAfterExpiry = await host.listSessions('client_a', USER_1, {
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(sessionsAfterExpiry).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        cols: 80,
        rows: 24,
      }),
    ])

    host.unregisterSocket('client_a', USER_1, socketA)
    shutdown()
  })

  test('batches rapid writes into a single ordered pty write via the input queue', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    mockPtys[0]?.emitData('ready')

    const attach = await host.attach('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 80,
      rows: 24,
      clientId: 'client_a',
    })
    expect(attach.ok).toBe(true)

    const writes = ['c', 'l', 'e', 'a', 'r'].map((data) =>
      host.write('client_a', USER_1, { terminalRuntimeSessionId, data, clientId: 'client_a' }),
    )

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(0)

    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(mockPtys[0]?.write).toHaveBeenCalledTimes(1)
    expect(mockPtys[0]?.write).toHaveBeenCalledWith('clear')
    await expect(Promise.all(writes)).resolves.toEqual(Array.from({ length: 5 }, () => ({ status: 'accepted' })))

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('exposes a closing-state supervisor after shutdown', async () => {
    const { host, shutdown } = buildRuntime()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(false)
    shutdown()
    expect(host.getDiagnostics().terminal.shuttingDown).toBe(true)
  })

  test('shutdown does not leave detached-user timers after closing registered sockets', () => {
    useFakeTimers()
    try {
      const { host, shutdown } = buildRuntime()
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_shutdown', USER_1, socket)

      shutdown()

      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('emits an identity change when a takeover succeeds', async () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)
    const terminalRuntimeSessionId = await createTerminalSession(host, 'client_1')
    socket.send.mockClear()

    const result = await host.takeover('client_a', USER_1, {
      terminalRuntimeSessionId,
      cols: 100,
      rows: 30,
      clientId: 'client_a',
    })
    expect(result.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const identityMessages = socket.send.mock.calls
      .map(([payload]) => JSON.parse(String(payload)))
      .filter((message) => message.type === 'identity')
    expect(identityMessages.length).toBeGreaterThan(0)
    expect(identityMessages.at(-1)).toMatchObject({
      event: {
        terminalRuntimeSessionId,
        controller: { clientId: 'client_a', status: 'connected' },
        canonicalCols: 100,
        canonicalRows: 30,
      },
    })

    host.unregisterSocket('client_a', USER_1, socket)
    shutdown()
  })

  test('T4.1: getDiagnostics exposes aggregate live session count and ring buffer stats', async () => {
    const { host, shutdown } = buildRuntime()
    try {
      // Empty runtime: no sessions, no buffers.
      let stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(0)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Create two sessions; their buffers start empty.
      const sessionA = await createTerminalSession(host, 'client_1')
      const sessionB = await createTerminalSession(host, 'client_1')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(0)
      expect(stats.maxRingBufferChars).toBe(0)

      // Emit data into the first session's PTY. The manager's
      // onOutput sink routes through broker.broadcast but also
      // appends to the per-session render buffer, which is what
      // the new diagnostic fields measure.
      mockPtys[0]?.emitData('aaaaa')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(5)
      expect(stats.maxRingBufferChars).toBe(5)

      // Emit more data into the second session. The max should
      // track the larger of the two; the total should sum both.
      mockPtys[1]?.emitData('bbbbbbbbbb')
      stats = host.getDiagnostics().terminal
      expect(stats.liveSessionCount).toBe(2)
      expect(stats.totalRingBufferChars).toBe(15)
      expect(stats.maxRingBufferChars).toBe(10)

      // The sessionA / sessionB identifiers are unused here — the
      // assertion is on aggregate state, not on which mock PTY
      // was which. Reference them so the linter doesn't complain
      // about unused locals.
      expect([sessionA, sessionB]).toHaveLength(2)
    } finally {
      shutdown()
    }
  })

  test('runtime routes a heartbeat envelope to the broker with the right (userId, clientId) pair', async () => {
    // Regression guard for the
    // `broker.recordHeartbeat(clientId, userId)` arg-order bug
    // that the original implementation shipped. The broker keys
    // on `userClientKey(userId, clientId)`, so a swapped call
    // silently misses every live heartbeat — the deadline scan
    // then prematurely flips presence offline for healthy
    // controllers. The broker unit tests passed because they
    // call the broker directly with the right order; this test
    // covers the wiring through the runtime's `handleRealtimeMessage`.
    //
    // The assertion is end-to-end: after a real heartbeat has been
    // routed through the runtime, advancing the fake clock past
    // the original deadline must NOT flip broker presence offline.
    // The raw socket would remain registered either way; this assertion
    // is about `isClientOnline`.
    const { host, shutdown, isClientOnline } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    useFakeTimers()
    try {
      vi.setSystemTime(TEST_NOW)

      // First heartbeat at t=0.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance just shy of the original deadline.
      vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS - 1_000)
      // Heartbeat again — this MUST use the right (userId, clientId)
      // order, otherwise the broker's clock never updates and the
      // very next scan would flip presence offline.
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      // Advance past the original 90 s deadline. A correctly routed
      // heartbeat (a real client sending every 30 s) means the
      // broker clock is fresh, so presence must remain online.
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      expect(isClientOnline('client_a')).toBe(true)
    } finally {
      vi.useRealTimers()
      shutdown()
    }
  })

  test('runtime answers terminal socket health pings with pong', () => {
    const { host, shutdown } = buildRuntime()
    const socket = { send: vi.fn(), close: vi.fn() }
    host.registerSocket('client_a', USER_1, socket)

    host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    shutdown()
  })

  test('runtime health ping refreshes broker presence before the next heartbeat scan', () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_a', USER_1, socket)

      vi.advanceTimersByTime(1)
      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'heartbeat' }))
      vi.advanceTimersByTime(99_999)
      expect(handle.isClientOnline('client_a')).toBe(true)

      host.handleRealtimeMessage('client_a', USER_1, socket, JSON.stringify({ type: 'ping', requestId: 'health_1' }))
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)

      expect(handle.isClientOnline('client_a')).toBe(true)
      expect(socket.close).not.toHaveBeenCalledWith(1001, 'terminal heartbeat timeout')
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong', requestId: 'health_1' }))
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: controller projection recovers when a long-idle client reconnects', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_idle', USER_1, socket)
      const terminalRuntimeSessionId = await createTerminalSession(host, 'client_idle')

      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_idle')).toBe(false)
      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: null,
        }),
      ])

      const reconnectedSocket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_idle', USER_1, reconnectedSocket)
      expect(handle.isClientOnline('client_idle')).toBe(true)
      expect(
        await host.listSessions('client_idle', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).toEqual([
        expect.objectContaining({
          terminalRuntimeSessionId,
          controller: { clientId: 'client_idle', status: 'connected' },
        }),
      ])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: recovered heartbeat cancels detached cleanup after a heartbeat timeout', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_recovered')
      host.registerSocket('client_recovered', USER_1, socket)
      await createTerminalSession(host, 'client_recovered')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_recovered')).toBe(false)

      const reconnectedSocket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_recovered', USER_1, reconnectedSocket)
      expect(handle.isClientOnline('client_recovered')).toBe(true)

      for (let elapsed = 0; elapsed < DETACHED_TTL_MS + 1; elapsed += HEARTBEAT_INTERVAL_MS) {
        await advanceTimersAndFlush(HEARTBEAT_INTERVAL_MS)
        host.handleRealtimeMessage('client_recovered', USER_1, reconnectedSocket, JSON.stringify({ type: 'heartbeat' }))
      }
      await vi.runOnlyPendingTimersAsync()
      await expect(
        host.listSessions('client_recovered', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: detached TTL cleans up when heartbeat timeout leaves only half-open sockets', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_half_open')
      host.registerSocket('client_half_open', USER_1, socket)
      await createTerminalSession(host, 'client_half_open')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(host.getDiagnostics().terminal.registeredSockets).toBe(0)
      expect(handle.isClientOnline('client_half_open')).toBe(false)

      await advanceTimersAndFlush(DETACHED_TTL_MS + 1)
      await vi.runOnlyPendingTimersAsync()

      expect(host.getDiagnostics().terminal.liveSessionCount).toBe(0)
      WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_half_open')
      await expect(
        host.listSessions('client_half_open', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: late socket drain does not extend detached TTL after heartbeat timeout', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_late_drain')
      host.registerSocket('client_late_drain', USER_1, socket)
      await createTerminalSession(host, 'client_late_drain')

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_late_drain')).toBe(false)

      await advanceTimersAndFlush(DETACHED_TTL_MS - 1_000)
      host.unregisterSocket('client_late_drain', USER_1, socket)
      await advanceTimersAndFlush(1_001)
      await vi.runOnlyPendingTimersAsync()

      expect(host.getDiagnostics().terminal.liveSessionCount).toBe(0)
      WORKSPACE_RUNTIME_ID = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_late_drain')
      await expect(
        host.listSessions('client_late_drain', USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a silent client (no heartbeats) is marked offline past the deadline', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      vi.setSystemTime(TEST_NOW)
      const handle = buildRuntime()
      const { host } = handle
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      host.registerSocket('client_silent', USER_1, socket)

      vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
      expect(handle.isClientOnline('client_silent')).toBe(false)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: detached client expiry releases its repo memberships without closing sibling epochs', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_expiring')).toBe(WORKSPACE_RUNTIME_ID)
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_survivor')
      const survivorSocket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_survivor', USER_1, survivorSocket)
      const socket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_expiring', USER_1, socket)
      handle.host.unregisterSocket('client_expiring', USER_1, socket)

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_expiring')).toEqual({
        released: false,
        runtimeClosed: false,
      })
      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_survivor')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: client expiry removes stale terminal authority while a replacement client keeps the session', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      const oldClientId = 'client_before_reload'
      const replacementClientId = 'client_after_reload'
      acquireWorkspaceRuntime(USER_1, REPO_ROOT, oldClientId)
      const oldSocket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket(oldClientId, USER_1, oldSocket)
      const terminalRuntimeSessionId = await createTerminalSession(handle.host, oldClientId)

      handle.host.unregisterSocket(oldClientId, USER_1, oldSocket)
      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, replacementClientId)).toBe(WORKSPACE_RUNTIME_ID)
      const replacementSocket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket(replacementClientId, USER_1, replacementSocket)
      await expect(
        handle.host.listSessions(replacementClientId, USER_1, {
          workspaceId: REPO_ROOT,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        }),
      ).resolves.toEqual([expect.objectContaining({ terminalRuntimeSessionId, controller: null })])

      await expect(
        handle.host.attach(replacementClientId, USER_1, {
          terminalRuntimeSessionId,
          cols: 100,
          rows: 30,
          clientId: replacementClientId,
        }),
      ).resolves.toMatchObject({
        ok: true,
        controller: { clientId: replacementClientId, status: 'connected' },
      })
      expect(handle.host.getDiagnostics().terminal.liveSessionCount).toBe(1)
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a repo membership that never establishes realtime presence expires', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_never_online')

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_never_online')).toEqual({
        released: false,
        runtimeClosed: false,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: first realtime presence cancels the orphan membership expiry', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_claimed_before_expiry')
      const socket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_claimed_before_expiry', USER_1, socket)

      for (let elapsed = 0; elapsed < DETACHED_TTL_MS + 1; elapsed += HEARTBEAT_INTERVAL_MS) {
        handle.host.handleRealtimeMessage(
          'client_claimed_before_expiry',
          USER_1,
          socket,
          JSON.stringify({ type: 'heartbeat' }),
        )
        await advanceTimersAndFlush(HEARTBEAT_INTERVAL_MS)
      }

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_claimed_before_expiry')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: an already-online client acquires membership without an orphan timer', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      const socket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_online_before_acquire', USER_1, socket)
      const runtimeId = acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_online_before_acquire')

      for (let elapsed = 0; elapsed < DETACHED_TTL_MS + 1; elapsed += HEARTBEAT_INTERVAL_MS) {
        handle.host.handleRealtimeMessage(
          'client_online_before_acquire',
          USER_1,
          socket,
          JSON.stringify({ type: 'heartbeat' }),
        )
        await advanceTimersAndFlush(HEARTBEAT_INTERVAL_MS)
      }

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, runtimeId, 'client_online_before_acquire')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })

  test('runtime: a membership renewed after disconnect survives the stale expiry timer', async () => {
    useFakeTimers()
    let shutdownFn: (() => void) | undefined
    try {
      const handle = buildRuntime()
      shutdownFn = handle.shutdown
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_renewed')).toBe(WORKSPACE_RUNTIME_ID)
      const socket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_renewed', USER_1, socket)
      handle.host.unregisterSocket('client_renewed', USER_1, socket)
      expect(acquireWorkspaceRuntime(USER_1, REPO_ROOT, 'client_renewed')).toBe(WORKSPACE_RUNTIME_ID)
      const reconnectedSocket = { send: vi.fn(), close: vi.fn() }
      handle.host.registerSocket('client_renewed', USER_1, reconnectedSocket)

      await advanceTimersAndFlush(CLIENT_STATE_GRACE_MS + 1)

      expect(releaseWorkspaceRuntime(USER_1, REPO_ROOT, WORKSPACE_RUNTIME_ID, 'client_renewed')).toEqual({
        released: true,
        runtimeClosed: true,
      })
    } finally {
      vi.useRealTimers()
      shutdownFn?.()
    }
  })
})
