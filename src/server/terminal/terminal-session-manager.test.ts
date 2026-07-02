import { describe, expect, test, vi } from 'vitest'
import type { TerminalAttachResult } from '#/shared/terminal-types.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'

const USER_ID = 'user_terminal_session_manager'
const CLIENT_ID = 'client_terminal_session_manager'
const SCOPE = '/repo'
const WORKTREE_PATH = '/repo'
const TERMINAL_SESSION_ID = 'session-1'

function createDeferredPtySupervisor(): PtySupervisor & {
  spawns: Array<(result: PtySpawnResult) => void>
  killed: string[]
  emitData(terminalRuntimeSessionId: string, data: string): void
  emitExit(terminalRuntimeSessionId: string): void
} {
  const spawns: Array<(result: PtySpawnResult) => void> = []
  const killed: string[] = []
  const dataListenersByPtySessionId = new Map<string, Set<(data: string) => void>>()
  const exitListenersByPtySessionId = new Map<string, Set<() => void>>()

  return {
    mode: 'in-process',
    spawns,
    killed,
    spawn() {
      return new Promise<PtySpawnResult>((resolve) => {
        spawns.push(resolve)
      })
    },
    write: vi.fn(),
    resize: vi.fn(),
    kill(handle) {
      killed.push(handle.ptySessionId)
    },
    onData(handle, listener) {
      const listeners = dataListenersByPtySessionId.get(handle.ptySessionId) ?? new Set()
      listeners.add(listener)
      dataListenersByPtySessionId.set(handle.ptySessionId, listeners)
      return {
        // Keep callbacks callable after dispose so stale-event guards are exercised.
        dispose: vi.fn(),
      }
    },
    onExit(handle, listener) {
      const listeners = exitListenersByPtySessionId.get(handle.ptySessionId) ?? new Set()
      listeners.add(() => listener(null, null))
      exitListenersByPtySessionId.set(handle.ptySessionId, listeners)
      return {
        // Keep callbacks callable after dispose so stale-event guards are exercised.
        dispose: vi.fn(),
      }
    },
    processName() {
      return 'zsh'
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
        restartAttempts: 0,
        restartScheduled: false,
        shuttingDown: false,
        lastSuccessfulResponseAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        lastFailure: null,
      }
    },
    shutdown: vi.fn(),
    emitData(ptySessionId, data) {
      for (const listener of Array.from(dataListenersByPtySessionId.get(ptySessionId) ?? [])) listener(data)
    },
    emitExit(ptySessionId) {
      for (const listener of Array.from(exitListenersByPtySessionId.get(ptySessionId) ?? [])) listener()
    },
  }
}

function createManager(supervisor: PtySupervisor) {
  return new TerminalSessionManager<string>(
    supervisor,
    {
      onOutput: vi.fn(),
      onExit: vi.fn(),
    },
    {
      terminalSessionIds: vi.fn(() => []),
    },
    () => true,
  )
}

function ptySpawnSuccess(id: string): { ok: true; handle: PtyHandle; processName: string } {
  return { ok: true, handle: createPtyHandle(id), processName: 'zsh' }
}

async function createSession(
  manager: TerminalSessionManager<string>,
  supervisor: ReturnType<typeof createDeferredPtySupervisor>,
): Promise<Extract<TerminalAttachResult, { ok: true }>> {
    const pending = manager.ensureSession({
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoInstanceId: 'repo-instance-test',
    terminalSessionId: TERMINAL_SESSION_ID,
    worktreePath: WORKTREE_PATH,
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

describe('TerminalSessionManager PTY spawn ownership', () => {
  test('waits for an in-flight create spawn before reusing the same terminalSessionId', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)

    const first = manager.ensureSession({
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoInstanceId: 'repo-instance-test',
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const second = manager.ensureSession({
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoInstanceId: 'repo-instance-test',
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      clientId: CLIENT_ID,
    })

    expect(supervisor.spawns).toHaveLength(1)
    supervisor.spawns.shift()?.({ ok: false, message: 'spawn failed' })

    await expect(first).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(second).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('kills a PTY that resolves after its session was closed before binding', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)

    const pending = manager.ensureSession({
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoInstanceId: 'repo-instance-test',
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const [openingSession] = await manager.listSessionsForUser(USER_ID, SCOPE)
    expect(openingSession).toBeDefined()
    expect(manager.closeSessionForUser(USER_ID, openingSession!.terminalRuntimeSessionId)).toBe(true)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_spawn_123456'))

    await expect(pending).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(supervisor.killed).toEqual(['pty_late_spawn_123456'])
  })

  test('kills an older restart PTY when a newer restart generation wins', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_one_123'))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_123'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })

    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_one_123'])
    supervisor.emitData('pty_restart_one_123', 'stale output')

    supervisor.emitExit('pty_restart_one_123')
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])

    expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).toBe(true)
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_one_123', 'pty_restart_two_123'])
  })

  test('treats an older restart failure as stale when a newer restart generation wins', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    supervisor.spawns.shift()?.({ ok: false, message: 'old restart failed' })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_456'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        phase: 'restarting',
        message: null,
      }),
    ])
  })

  test('attach waits past a stale restart failure for the active restart generation', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const attach = manager.attachSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    supervisor.spawns.shift()?.({ ok: false, message: 'old restart failed' })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_789'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })
    await expect(attach).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })
  })
})
