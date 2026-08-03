import { expect, vi } from 'vitest'
import {
  terminalExecutionPath,
  type TerminalAttachResult,
  type TerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { createPtyHandle, type PtySpawnResult, type PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { createPtyEventChannel, type PtyEventSink } from '#/server/terminal/pty-event-lease.ts'
import {
  TerminalSessionManager,
  type TerminalEnsureSessionInput,
  type TerminalEventSink,
} from '#/server/terminal/terminal-session-manager.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

export const USER_ID = 'user_terminal_session_manager'
export const CLIENT_ID = 'client_terminal_session_manager'
export const SCOPE = 'goblin+file:///repo\0repo-runtime-test'
export const BRANCH_NAME = 'feature/test'
export const WORKTREE_PATH = '/repo'
export const TERMINAL_SESSION_ID = 'term-111111111111111111111'
export const WORKSPACE_ID = requiredWorkspaceLocator('goblin+file:///repo')
export const WORKTREE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: WORKSPACE_ID,
  workspaceRuntimeId: 'repo-runtime-test',
  root: WORKSPACE_ID,
}
export const LINKED_WORKTREE_TARGET = {
  ...WORKTREE_TARGET,
  workspaceRuntimeId: 'repo-runtime-linked',
  workspaceId: requiredWorkspaceLocator('goblin+file:///repo-linked'),
  root: requiredWorkspaceLocator('goblin+file:///repo-linked/worktree'),
}

const ptyEventSinkById = new Map<string, PtyEventSink>()

export function createWorkspaceRuntimeRetentionHost() {
  return {
    retain: vi.fn(() => ({ release: vi.fn() })),
  }
}

export function requiredWorkspaceLocator(input: string) {
  const locator = canonicalWorkspaceLocator(input)
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

export async function noRetirementTabsSnapshot(
  _userId: string,
  _session: TerminalSessionSummary,
  commit: (tabsBeforeRetirement: WorkspacePaneTabEntry[] | null) => undefined,
): Promise<void> {
  commit(null)
}

interface DeferredPtySupervisor extends PtySupervisor {
  spawns: Array<(result: PtySpawnResult) => void>
  killed: string[]
  emitData(terminalRuntimeSessionId: string, data: string): void
  emitExit(terminalRuntimeSessionId: string): void
  setProcessName(processName: string): void
}

// The PTY boundary has no library test double; expose deterministic spawn and event control to the manager suites.
export function createDeferredPtySupervisor(): DeferredPtySupervisor {
  const spawns: Array<(result: PtySpawnResult) => void> = []
  const killed: string[] = []
  let currentProcessName = 'zsh'

  return {
    mode: 'in-process',
    spawns,
    killed,
    spawn: vi.fn(() => {
      return new Promise<PtySpawnResult>((resolve) => {
        spawns.push(resolve)
      })
    }),
    write: vi.fn(async () => ({ status: 'accepted' as const })),
    resize: vi.fn(async () => true),
    kill(handle) {
      killed.push(handle.ptySessionId)
    },
    waitForExit: vi.fn(() => new Promise<void>(() => {})),
    async killAndWait(handle) {
      killed.push(handle.ptySessionId)
    },
    getDiagnostics() {
      return {
        mode: 'in-process',
        state: 'running',
        workerRunning: false,
        workerPid: null,
        workerStartedAt: null,
        workerUptimeMs: null,
        pendingRequests: spawns.length,
        consecutiveWorkerInvalidations: 0,
        shuttingDown: false,
        lastSuccessfulResponseAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        lastFailure: null,
      }
    },
    shutdown: vi.fn(),
    emitData(ptySessionId, data) {
      ptyEventSinkById.get(ptySessionId)?.data({ data, processName: currentProcessName })
    },
    emitExit(ptySessionId) {
      ptyEventSinkById.get(ptySessionId)?.exit(null, null)
    },
    setProcessName(processName) {
      currentProcessName = processName
    },
  }
}

export function createManagerWithPresence(
  supervisor: PtySupervisor,
  sink: Partial<TerminalEventSink<string>>,
  isClientOnline: (clientId: string) => boolean,
) {
  return new TerminalSessionManager<string>(
    supervisor,
    {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      withRetirementTabsSnapshot: noRetirementTabsSnapshot,
      ...sink,
    },
    (_userId, clientId) => isClientOnline(clientId),
    createWorkspaceRuntimeRetentionHost(),
  )
}

export function createAlwaysOnlineManager(supervisor: PtySupervisor, sink: Partial<TerminalEventSink<string>> = {}) {
  return createManagerWithPresence(supervisor, sink, () => true)
}

export function tabsBeforeRetirement(): WorkspacePaneTabEntry[] {
  return [
    { type: 'files', tabId: 'workspace-pane:files' },
    { type: 'terminal', runtimeSessionId: TERMINAL_SESSION_ID },
  ]
}

export function ptySpawnSuccess(id: string): Extract<PtySpawnResult, { ok: true }> {
  const events = createPtyEventChannel()
  ptyEventSinkById.set(id, events.sink)
  return { ok: true, handle: createPtyHandle(id), processName: 'zsh', events: events.lease }
}

export async function createSession(
  manager: TerminalSessionManager<string>,
  supervisor: DeferredPtySupervisor,
): Promise<Extract<TerminalAttachResult, { ok: true }>> {
  const pending = ensureSession(manager, {
    userId: USER_ID,
    target: WORKTREE_TARGET,
    terminalSessionId: TERMINAL_SESSION_ID,
    cwd: '/tmp',
    cols: 80,
    rows: 24,
    clientId: CLIENT_ID,
  })
  supervisor.spawns.shift()?.(ptySpawnSuccess('pty_initial_123456'))
  const result = await pending
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result
}

export function ensureSession(
  manager: TerminalSessionManager<string>,
  input: Omit<TerminalEnsureSessionInput<string>, 'physicalWorktreeCapability'> & {
    cols: number
    rows: number
    clientId?: string
  },
): Promise<TerminalAttachResult> {
  const { cols, rows, clientId = CLIENT_ID, ...prepareInput } = input
  const prepared = manager.prepareSession({
    ...prepareInput,
    physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(terminalExecutionPath(prepareInput.target)),
  })
  if (!prepared.ok) return Promise.resolve(prepared)
  const committed = prepared.admission.commit({
    presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
  })
  prepared.admission.publishCommittedEffects()
  return manager.attachSession(
    input.userId,
    prepared.terminalRuntimeSessionId,
    committed.terminalRuntimeGeneration,
    cols,
    rows,
    clientId,
    input.signal,
  )
}
