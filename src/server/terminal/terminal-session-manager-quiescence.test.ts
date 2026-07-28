import { describe, expect, test, vi } from 'vitest'
import type { PtyHandle } from '#/server/terminal/pty-supervisor.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import {
  CLIENT_ID,
  LINKED_WORKTREE_TARGET,
  SCOPE,
  TERMINAL_SESSION_ID,
  USER_ID,
  WORKSPACE_ID,
  WORKTREE_PATH,
  WORKTREE_TARGET,
  createAlwaysOnlineManager,
  createDeferredPtySupervisor,
  ensureSession,
  ptySpawnSuccess,
  requiredWorkspaceLocator,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager physical worktree quiescence', () => {
  test.each(['resolve', 'reject'] as const)(
    'reports an already-closed outcome when Git cleanup removes authority before PTY disposal %s',
    async (disposalResult) => {
      const supervisor = createDeferredPtySupervisor()
      let resolveDirectClose!: () => void
      let rejectDirectClose!: (error: Error) => void
      const directCloseDisposal = new Promise<void>((resolve, reject) => {
        resolveDirectClose = resolve
        rejectDirectClose = reject
      })
      supervisor.killAndWait = vi
        .fn()
        .mockImplementationOnce(async () => await directCloseDisposal)
        .mockResolvedValue(undefined)
      const onLifecycle = vi.fn()
      const manager = createAlwaysOnlineManager(supervisor, { onLifecycle })
      const pending = ensureSession(manager, {
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: TERMINAL_SESSION_ID,
        cwd: WORKTREE_PATH,
        cols: 80,
        rows: 24,
        clientId: CLIENT_ID,
      })
      supervisor.spawns.shift()?.(ptySpawnSuccess('pty_cleanup_close_race_123'))
      const created = await pending
      if (!created.ok) throw new Error(created.message)

      const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
      await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledOnce())

      const cleanup = manager.commitGitSessionInvalidation(USER_ID, SCOPE)
      expect(cleanup.removedCount).toBe(1)
      cleanup.publishEffects()
      onLifecycle.mockClear()
      if (disposalResult === 'resolve') resolveDirectClose()
      else rejectDirectClose(new Error('PTY close failed after authority removal'))

      await expect(close).resolves.toEqual({ kind: 'already-closed' })
      await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
      expect(onLifecycle).not.toHaveBeenCalled()
    },
  )

  test('keeps the session authoritative when PTY exit re-enters close before kill acknowledgement', async () => {
    const supervisor = createDeferredPtySupervisor()
    let acknowledgeKill!: () => void
    const killAcknowledged = new Promise<void>((resolve) => {
      acknowledgeKill = resolve
    })
    supervisor.killAndWait = vi.fn(async (handle) => {
      supervisor.emitExit(handle.ptySessionId)
      await killAcknowledged
    })
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_reentrant_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
    await flushMicrotasks(2)
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toHaveLength(1)

    acknowledgeKill()
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
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
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_concurrent_close_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const quiescence = manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
    const directClose = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
    await Promise.resolve()
    expect(killAndWait).toHaveBeenCalledOnce()
    expect(onSessionClosed).not.toHaveBeenCalled()
    await expect(
      ensureSession(manager, {
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: TERMINAL_SESSION_ID,
        cwd: WORKTREE_PATH,
        cols: 80,
        rows: 24,
        clientId: CLIENT_ID,
      }),
    ).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    expect(supervisor.spawns).toEqual([])

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(directClose).resolves.toEqual({ kind: 'already-closed' })
    expect(onSessionClosed).toHaveBeenCalledOnce()
  })

  test('quiesces a physical worktree opened through a different repository entry', async () => {
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(async () => {})
    const manager = createAlwaysOnlineManager(supervisor)
    const linkedRepoRoot = requiredWorkspaceLocator('goblin+file:///repo-linked')
    const physicalWorktreePath = '/repo-linked/worktree'
    const scope = terminalSessionRuntimeScope(linkedRepoRoot, 'repo-runtime-linked')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: LINKED_WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: physicalWorktreePath,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_cross_repo_root_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(physicalWorktreePath)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId: linkedRepoRoot, workspaceRuntimeId: 'repo-runtime-linked', scope }],
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
    const manager = createAlwaysOnlineManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })

    let quiesced = false
    const quiescence = manager
      .closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
      .then((result) => {
        quiesced = true
        return result
      })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_spawn_123'))
    await Promise.resolve()
    expect(quiesced).toBe(false)

    acknowledgeKill()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.unavailable' })
  })

  test('keeps a timed-out PTY addressable and reports its user scope for retry', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async (_handle: PtyHandle): Promise<void> => {
      throw new Error('PTY close timed out')
    })
    supervisor.killAndWait = killAndWait
    const manager = createAlwaysOnlineManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_quiescence_123456'))
    await pending

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: false,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
      message: 'PTY close timed out',
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
    ])

    killAndWait.mockResolvedValueOnce(undefined)
    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('returns stale on abort while quiescence waits for late spawn retirement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAcknowledged = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => await killAcknowledged.promise)
    supervisor.killAndWait = killAndWait
    const manager = createAlwaysOnlineManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.workspace-runtime-stale' })

    let quiesced = false
    const quiescence = manager
      .closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH))
      .then((value) => {
        quiesced = true
        return value
      })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_abort_123456'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    expect(quiesced).toBe(false)

    killAcknowledged.resolve()
    await expect(quiescence).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('retains a late-spawn owner after the first retirement failure and retries cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const killAndWait = vi.fn(async () => {})
    killAndWait.mockRejectedValueOnce(new Error('PTY close timed out'))
    supervisor.killAndWait = killAndWait
    const manager = createAlwaysOnlineManager(supervisor)
    const workspaceId = WORKSPACE_ID
    const scope = terminalSessionRuntimeScope(workspaceId, 'repo-runtime-test')
    const controller = new AbortController()
    const pendingCreate = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
      signal: controller.signal,
    })

    controller.abort()
    await expect(pendingCreate).resolves.toEqual({ ok: false, message: 'error.workspace-runtime-stale' })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_retry_123456'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'error.workspace-runtime-stale' }),
    ])
    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: false,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
      message: 'PTY close timed out',
    })
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'PTY close timed out' }),
    ])
    expect(killAndWait).toHaveBeenCalledOnce()
    await Promise.resolve()

    await expect(
      manager.closeSessionsForPhysicalWorktree(testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)),
    ).resolves.toEqual({
      ok: true,
      scopes: [{ userId: USER_ID, workspaceId, workspaceRuntimeId: 'repo-runtime-test', scope }],
    })
    expect(killAndWait).toHaveBeenCalledTimes(2)
    await expect(manager.listSessionsForUser(USER_ID, scope)).resolves.toEqual([])
  })

  test('waits for pre-restart PTY termination before spawning the replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const termination = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await termination.promise)
    const manager = createAlwaysOnlineManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_before_barrier_123'))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      CLIENT_ID,
    )
    await flushMicrotasks(2)
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
    const manager = createAlwaysOnlineManager(supervisor)
    const scope = terminalSessionRuntimeScope(WORKSPACE_ID, 'repo-runtime-test')
    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: WORKTREE_PATH,
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    supervisor.spawns.shift()?.(ptySpawnSuccess(retiredPtySessionId))
    const created = await pending
    if (!created.ok) throw new Error(created.message)

    await expect(
      manager.restartSession(
        USER_ID,
        created.terminalRuntimeSessionId,
        created.terminalRuntimeGeneration,
        80,
        24,
        CLIENT_ID,
      ),
    ).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    expect(supervisor.spawns).toEqual([])
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([retiredPtySessionId])

    retiredExited = true
    supervisor.emitExit(retiredPtySessionId)
    const retry = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      80,
      24,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess(replacementPtySessionId))
    await expect(retry).resolves.toMatchObject({ ok: true })
    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(killAndWait.mock.calls.map(([handle]) => handle.ptySessionId)).toEqual([
      retiredPtySessionId,
      retiredPtySessionId,
      replacementPtySessionId,
    ])
  })
})
