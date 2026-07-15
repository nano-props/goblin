import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionEnsureAttachResult } from '#/server/terminal/terminal-session-ensurer.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import {
  TerminalSessionManager,
  type TerminalEnsureSessionInput,
  type TerminalEventSink,
} from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { testPhysicalWorktreeCapability } from '#/server/test-utils/physical-worktree-identity.ts'

const USER_ID = 'user_terminal_session_manager'
const CLIENT_ID = 'client_terminal_session_manager'
const SCOPE = '/repo'
const BRANCH_NAME = 'feature/test'
const WORKTREE_PATH = '/repo'
const TERMINAL_SESSION_ID = 'term-111111111111111111111'

function createDeferredPtySupervisor(): PtySupervisor & {
  spawns: Array<(result: PtySpawnResult) => void>
  killed: string[]
  emitData(terminalRuntimeSessionId: string, data: string): void
  emitExit(terminalRuntimeSessionId: string): void
  setProcessName(processName: string): void
} {
  const spawns: Array<(result: PtySpawnResult) => void> = []
  const killed: string[] = []
  const dataListenersByPtySessionId = new Map<string, Set<(data: string) => void>>()
  const exitListenersByPtySessionId = new Map<string, Set<() => void>>()
  let currentProcessName = 'zsh'

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
    async killAndWait(handle) {
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
      return currentProcessName
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
    setProcessName(processName) {
      currentProcessName = processName
    },
  }
}

function createManager(supervisor: PtySupervisor, sink: Partial<TerminalEventSink<string>> = {}) {
  return new TerminalSessionManager<string>(
    supervisor,
    {
      onOutput: vi.fn(),
      onExit: vi.fn(),
      ...sink,
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
): Promise<Extract<TerminalSessionEnsureAttachResult, { ok: true }>> {
  const pending = ensureSession(manager, {
    userId: USER_ID,
    scope: SCOPE,
    repoRoot: SCOPE,
    repoRuntimeId: 'repo-runtime-test',
    branch: BRANCH_NAME,
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

function ensureSession(
  manager: TerminalSessionManager<string>,
  input: Omit<TerminalEnsureSessionInput<string>, 'physicalWorktreeCapability'>,
): Promise<TerminalSessionEnsureAttachResult> {
  return manager['ensureSession']({
    ...input,
    physicalWorktreeCapability: testPhysicalWorktreeCapability(input.worktreePath),
  })
}

describe('TerminalSessionManager PTY spawn ownership', () => {
  test('waits for an in-flight create spawn before reusing the same terminalSessionId', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)

    const first = ensureSession(manager, {
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const second = ensureSession(manager, {
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
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

    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope: SCOPE,
      repoRoot: SCOPE,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const [openingSession] = await manager.listSessionsForUser(USER_ID, SCOPE)
    expect(openingSession).toBeDefined()
    const close = manager.closeSessionForUser(USER_ID, openingSession!.terminalRuntimeSessionId)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_spawn_123456'))

    await expect(close).resolves.toBe(true)
    await expect(pending).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(supervisor.killed).toEqual(['pty_late_spawn_123456'])
  })

  test('reports scope close reason for repo cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)

    await manager.closeSessionsForRepo(USER_ID, SCOPE)

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
  })

  test('reports detached-user close reason for detached TTL cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)

    await manager.closeSessionsForUser(USER_ID)

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'detached-user',
    )
  })

  test('supersedes an older restart before spawning the latest replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_123'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalCols: 120,
      canonicalRows: 40,
    })

    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])

    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_two_123'])
  })

  test('publishes only the latest restart failure when an older restart is superseded', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    const secondRestart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 120, 40, CLIENT_ID)

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.({ ok: false, message: 'new restart failed' })

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toEqual({ ok: false, message: 'new restart failed' })

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 3,
        phase: 'error',
        message: 'new restart failed',
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

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
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

describe('TerminalSessionManager physical worktree quiescence', () => {
  test('keeps the session authoritative when PTY exit re-enters close before kill acknowledgement', async () => {
    const supervisor = createDeferredPtySupervisor()
    let exitListener: (() => void) | null = null
    supervisor.onExit = vi.fn((_handle, listener) => {
      exitListener = listener
      return { dispose: vi.fn() }
    })
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async () => {
      exitListener?.()
      await killAcknowledged
    })
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_reentrant_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const close = manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    await Promise.resolve()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toHaveLength(1)

    acknowledgeKill()
    await expect(close).resolves.toBe(true)
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('joins a concurrent direct close to the same acknowledged close operation', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    const killAndWait = vi.fn(async () => await killAcknowledged)
    supervisor.killAndWait = killAndWait
    const onSessionClosed = vi.fn()
    const manager = createManager(supervisor, { onSessionClosed })
    const repoRoot = '/repo'
    const scope = terminalSessionRuntimeScope(repoRoot, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_concurrent_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const quiescence = manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH))
    const directClose = manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    expect(killAndWait).toHaveBeenCalledOnce()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(
      ensureSession(manager, {
        userId: USER_ID,
        scope,
        repoRoot,
        repoRuntimeId: 'repo-runtime-test',
        branch: BRANCH_NAME,
        terminalSessionId: TERMINAL_SESSION_ID,
        worktreePath: WORKTREE_PATH,
        cwd: WORKTREE_PATH,
        cols: 80,
        rows: 24,
        clientId: CLIENT_ID,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(supervisor.spawns).toEqual([])

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({ ok: true, scopes: [{ userId: USER_ID, repoRoot, scope }] })
    await expect(directClose).resolves.toBe(true)
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('quiesces a physical worktree opened through a different repository entry', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(async () => {})
    const manager = createManager(supervisor)
    const linkedRepoRoot = '/repo-linked'
    const physicalWorktreePath = '/repo-linked/worktree'
    const scope = terminalSessionRuntimeScope(linkedRepoRoot, 'repo-runtime-linked')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: linkedRepoRoot,
      repoRuntimeId: 'repo-runtime-linked',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: physicalWorktreePath,
      cwd: physicalWorktreePath,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_cross_repo_root_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(physicalWorktreePath))).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, repoRoot: linkedRepoRoot, scope }],
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('waits for an in-flight spawn and its kill acknowledgement before reporting quiescence', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async () => await killAcknowledged)
    const manager = createManager(supervisor)
    const repoRoot = '/repo'
    const scope = terminalSessionRuntimeScope(repoRoot, 'repo-runtime-test')
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })

    let quiesced = false
    const quiescence = manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH)).then((result) => {
      quiesced = true
      return result
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_spawn_123'))
    await Promise.resolve()
    expect(quiesced).toBe(false)

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({ ok: true, scopes: [{ userId: USER_ID, repoRoot, scope }] })
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.unavailable' })
  })

  test('keeps a timed-out PTY addressable and reports its user scope for retry', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async (_handle: PtyHandle): Promise<void> => {
      throw new Error('PTY close timed out')
    })
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const repoRoot = '/repo'
    const scope = terminalSessionRuntimeScope(repoRoot, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_123456'))
    await pending

    await expect(manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH))).resolves.toEqual({
      ok: false,
      scopes: [{ userId: USER_ID, repoRoot, scope }],
      message: 'PTY close timed out',
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
    ])

    killAndWait.mockResolvedValueOnce(undefined)
    await expect(manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH))).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, repoRoot, scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('returns stale on abort while quiescence waits for late spawn retirement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAcknowledged = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => await killAcknowledged.promise)
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const repoRoot = '/repo'
    const scope = terminalSessionRuntimeScope(repoRoot, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })

    let quiesced = false
    const quiescence = manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH)).then((value) => {
      quiesced = true
      return value
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_abort_123456'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    expect(quiesced).toBe(false)

    killAcknowledged.resolve()
    await expect(quiescence).resolves.toEqual({ ok: true, scopes: [{ userId: USER_ID, repoRoot, scope }] })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('retains a late-spawn owner after the first retirement failure and retries cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async () => {})
    killAndWait.mockRejectedValueOnce(new Error('PTY close timed out'))
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const repoRoot = '/repo'
    const scope = terminalSessionRuntimeScope(repoRoot, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot,
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_retry_123456'))
    await vi.waitFor(async () => {
      await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
        expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
      ])
    })
    expect(killAndWait).toHaveBeenCalledOnce()
    await Promise.resolve()

    await expect(manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeCapability(WORKTREE_PATH))).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, repoRoot, scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('waits for pre-restart PTY termination before spawning the replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const termination = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await termination.promise)
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_before_barrier_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const restart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID)
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.spawns).toEqual([])

    termination.resolve()
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_after_barrier_1234'))
    await expect(restart).resolves.toMatchObject({ ok: true })
  })

  test('retains a timed-out pre-restart PTY until late exit can be confirmed', async () => {
    const supervisor = createDeferredPtySupervisor()
    const retiredPtySessionId = 'pty_before_restart_123'
    const replacementPtySessionId = 'pty_after_restart_1234'
    let retiredExited = false
    const killAndWait = vi.fn(async (handle: PtyHandle): Promise<void> => {
      if (handle.ptySessionId === retiredPtySessionId && !retiredExited) {
        throw new Error('PTY close timed out')
      }
    })
    supervisor.killAndWait = killAndWait
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess(retiredPtySessionId))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(
      manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID),
    ).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    expect(supervisor.spawns).toEqual([])
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([retiredPtySessionId])

    retiredExited = true
    supervisor.emitExit(retiredPtySessionId)
    const retry = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 80, 24, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess(replacementPtySessionId))
    await expect(retry).resolves.toMatchObject({ ok: true })
    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([
      retiredPtySessionId,
      retiredPtySessionId,
      replacementPtySessionId,
    ])
  })
})

describe('TerminalSessionManager versioned recovery projection', () => {
  test('advances revision when a new binding keeps the default process name', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.processName = vi.fn(() => 'terminal')
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const beforeBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(beforeBinding.sessions[0]).toMatchObject({ terminalRuntimeGeneration: 0, processName: 'terminal' })

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_default_process_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)
    const afterBinding = manager.terminalSessionsSnapshotForUser(USER_ID, scope)

    expect(afterBinding.revision).toBeGreaterThan(beforeBinding.revision)
    expect(created.terminalSessionsRevision).toBe(afterBinding.revision)
    expect(afterBinding.sessions[0]).toMatchObject({ terminalRuntimeGeneration: 1, processName: 'terminal' })
  })

  test('advances revision for visible session fields but not ordinary output', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_revision_123456'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const createdSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(created.terminalSessionsRevision).toBe(createdSnapshot.revision)
    expect(createdSnapshot.sessions).toEqual([
      expect.objectContaining({
        terminalSessionId: TERMINAL_SESSION_ID,
        processName: 'zsh',
        phase: 'opening',
        cols: 80,
        rows: 24,
      }),
    ])

    supervisor.emitData('pty_revision_123456', 'first output')
    const openedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(openedSnapshot.revision).toBeGreaterThan(createdSnapshot.revision)
    expect(openedSnapshot.sessions[0]).toMatchObject({ phase: 'open' })

    supervisor.emitData('pty_revision_123456', 'ordinary output')
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, scope).revision).toBe(openedSnapshot.revision)

    supervisor.setProcessName('node')
    supervisor.emitData('pty_revision_123456', 'process changed')
    const processSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(processSnapshot.revision).toBeGreaterThan(openedSnapshot.revision)
    expect(processSnapshot.sessions[0]).toMatchObject({ processName: 'node' })

    const beforeResize = processSnapshot.revision
    expect(manager.resizeSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)).toBe(true)
    const resizedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(resizedSnapshot.revision).toBeGreaterThan(beforeResize)
    expect(resizedSnapshot.sessions[0]).toMatchObject({ cols: 100, rows: 30 })

    await expect(manager.closeSessionForUser(USER_ID, created.terminalRuntimeSessionId)).resolves.toBe(true)
    const closedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, scope)
    expect(closedSnapshot.revision).toBeGreaterThan(resizedSnapshot.revision)
    expect(closedSnapshot.sessions).toEqual([])
  })

  test('returns hydration snapshots paired with the visible terminal collection revision', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createManager(supervisor)
    const scope = terminalSessionRuntimeScope('/repo', 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      scope,
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-test',
      branch: BRANCH_NAME,
      terminalSessionId: TERMINAL_SESSION_ID,
      worktreePath: WORKTREE_PATH,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_recovery_123456'))
    await pending
    supervisor.emitData('pty_recovery_123456', 'recoverable output')

    const recovery = await manager.recoverSessionsForUser(USER_ID, scope)

    expect(recovery.terminalSessions).toEqual(manager.terminalSessionsSnapshotForUser(USER_ID, scope))
    expect(recovery.snapshots).toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: recovery.terminalSessions.sessions[0]?.terminalRuntimeSessionId,
        terminalRuntimeGeneration: 1,
        snapshotSeq: expect.any(Number),
        outputEra: expect.any(Number),
      }),
    ])
  })
})

describe('TerminalSessionManager runtime binding generations', () => {
  test('publishes the PTY binding generation on first frames and realtime events', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const manager = createManager(supervisor, { onOutput })
    const created = await createSession(manager, supervisor)
    expect(created.terminalRuntimeGeneration).toBe(1)

    supervisor.emitData('pty_initial_123456', 'first')
    expect(onOutput).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeGeneration: 1 }),
    )

    const restart = manager.restartSession(USER_ID, created.terminalRuntimeSessionId, 100, 30, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_generation_two_123'))
    await expect(restart).resolves.toMatchObject({ ok: true, terminalRuntimeGeneration: 2 })

    supervisor.emitData('pty_generation_two_123', 'second')
    expect(onOutput).toHaveBeenLastCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeGeneration: 2 }),
    )
  })
})
