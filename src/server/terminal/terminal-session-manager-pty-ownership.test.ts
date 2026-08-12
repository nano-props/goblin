import { describe, expect, test, vi } from 'vitest'
import { createPtyHandle } from '#/server/terminal/pty-supervisor.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { terminalSessionRuntimeScope } from '#/server/terminal/terminal-session-scope.ts'

const EXPECTED_TERMINAL_SESSION_CAPACITY = 1024
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import {
  BRANCH_NAME,
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
  createSession,
  ensureSession,
  noRetirementTabsSnapshot,
  ptySpawnSuccess,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager PTY spawn ownership', () => {
  test('waits for an in-flight fresh attach before reusing the same terminalSessionId', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionsProjectionChanged })

    const first = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const second = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 100,
      rows: 30,
      clientId: CLIENT_ID,
    })

    expect(supervisor.spawns).toHaveLength(1)
    supervisor.spawns.shift()?.({ ok: false, message: 'spawn failed' })

    await expect(first).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(second).resolves.toEqual({ ok: false, message: 'spawn failed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ phase: 'error', message: 'spawn failed' }),
    ])
    expect(onSessionsProjectionChanged).toHaveBeenCalledTimes(2)
    expect(onSessionsProjectionChanged).toHaveBeenLastCalledWith(USER_ID, {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 2,
    })
  })

  test('kills a PTY that resolves after its session was closed before binding', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)

    const pending = ensureSession(manager, {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      cwd: '/tmp',
      cols: 80,
      rows: 24,
      clientId: CLIENT_ID,
    })
    const [openingSession] = await manager.listSessionsForUser(USER_ID, SCOPE)
    expect(openingSession).toBeDefined()
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBe(TERMINAL_SESSION_ID)
    const close = manager.closeSessionForUserOutcome(USER_ID, openingSession!.terminalRuntimeSessionId)

    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_late_spawn_123456'))

    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(pending).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()
    expect(supervisor.killed).toEqual(['pty_late_spawn_123456'])
  })

  test('reports scope close reason for repo cleanup', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)
    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBe(TERMINAL_SESSION_ID)

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE).publishEffects()

    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
  })

  test('invalidates a workspace runtime session and disposes its binding at the same authority boundary', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const release = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onSessionClosed },
      () => true,
      { retain: vi.fn(() => ({ release })) },
    )
    const created = await createSession(manager, supervisor)
    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(invalidation.removedSessions).toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).not.toHaveBeenCalled()
    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    expect(release).toHaveBeenCalledOnce()

    invalidation.publishEffects()
    invalidation.publishEffects()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
    manager.forceShutdown()
    expect(release).toHaveBeenCalledOnce()
  })

  test('revokes PTY mutation and output ownership at the authoritative invalidation boundary', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity, onOutput })
    const created = await createSession(manager, supervisor)
    const nativeResize = Promise.withResolvers<boolean>()
    vi.mocked(supervisor.resize).mockImplementationOnce(async () => await nativeResize.promise)
    onIdentity.mockClear()
    onOutput.mockClear()

    const resize = manager.resizeSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.resize).toHaveBeenCalledOnce())

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    supervisor.emitData('pty_initial_123456', 'late output')
    nativeResize.resolve(true)

    await expect(resize).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onIdentity).not.toHaveBeenCalled()
    expect(onOutput).not.toHaveBeenCalled()

    expect(supervisor.killed).toContain('pty_initial_123456')
    invalidation.publishEffects()
  })

  test('keeps a committed invalidation when publication effects fail', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor, {
      onSessionClosed: vi.fn(() => {
        throw new Error('publication failed')
      }),
    })
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(() => invalidation.publishEffects()).not.toThrow()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('retires an invalidated PTY through the acknowledged boundary and releases its shutdown owner', async () => {
    const supervisor = createDeferredPtySupervisor()
    const kill = vi.fn()
    const killAndWait = vi.fn(async () => undefined)
    supervisor.kill = kill
    supervisor.killAndWait = killAndWait
    const manager = createAlwaysOnlineManager(supervisor)
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    invalidation.publishEffects()
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await flushMicrotasks(2)
    manager.forceShutdown()

    expect(killAndWait).toHaveBeenCalledWith(createPtyHandle('pty_initial_123456'))
    expect(kill).not.toHaveBeenCalled()
  })

  test('transfers a failed scope retirement to supervisor shutdown without retrying', async () => {
    const supervisor = createDeferredPtySupervisor()
    const eventualExit = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => {
      throw new Error('PTY close timed out')
    })
    const kill = vi.fn()
    supervisor.waitForExit = vi.fn(async () => await eventualExit.promise)
    supervisor.killAndWait = killAndWait
    supervisor.kill = kill
    const manager = createAlwaysOnlineManager(supervisor)
    await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    expect(invalidation.removedCount).toBe(1)
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    await Promise.resolve()
    manager.forceShutdown()

    expect(kill).not.toHaveBeenCalled()
    eventualExit.resolve()
  })

  test('keeps an invalidated PTY capacity slot until native retirement completes', async () => {
    const supervisor = createDeferredPtySupervisor()
    const retirement = Promise.withResolvers<void>()
    supervisor.killAndWait = vi.fn(async () => await retirement.promise)
    const manager = createAlwaysOnlineManager(supervisor)
    await createSession(manager, supervisor)

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    const reservations = Array.from({ length: EXPECTED_TERMINAL_SESSION_CAPACITY - 1 }, (_, index) =>
      manager.prepareSession({
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: `replacement-${index}`,
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    )
    expect(reservations.every((reservation) => reservation.ok)).toBe(true)
    expect(
      manager.prepareSession({
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: 'replacement-over-limit',
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    ).toEqual({ ok: false, message: 'error.terminal-session-limit-reached' })

    retirement.resolve()
    await vi.waitFor(() => expect(manager.getPendingResourceRetirementCount()).toBe(0))
    expect(
      manager.prepareSession({
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: 'replacement-after-retirement',
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    ).toMatchObject({ ok: true })
  })

  test('keeps invalidation retirement ownership until a late native spawn exits', async () => {
    const supervisor = createDeferredPtySupervisor()
    const termination = Promise.withResolvers<void>()
    const killAndWait = vi.fn(async () => await termination.promise)
    const kill = vi.fn()
    supervisor.waitForExit = vi.fn(async () => await termination.promise)
    supervisor.killAndWait = killAndWait
    supervisor.kill = kill
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: WORKTREE_PATH,
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()
    const attach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_invalidated_late_spawn_123'))
    await vi.waitFor(() => expect(killAndWait).toHaveBeenCalledOnce())
    expect(kill).not.toHaveBeenCalled()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])

    termination.resolve()
    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await Promise.resolve()
    manager.forceShutdown()
    expect(killAndWait).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
  })

  test('commits scope invalidation before publishing its close effects', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onSessionClosed = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onSessionClosed })
    const created = await createSession(manager, supervisor)

    const invalidation = manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(invalidation.removedSessions).toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).not.toHaveBeenCalled()

    invalidation.publishEffects()

    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
      'scope',
    )
  })

  test('commits the complete runtime scope before releasing runtime retentions', () => {
    const supervisor = createDeferredPtySupervisor()
    const observedSessionCounts: number[] = []
    let manager: TerminalSessionManager<string>
    manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput: vi.fn(), onExit: vi.fn(), withRetirementTabsSnapshot: noRetirementTabsSnapshot },
      () => true,
      {
        retain: vi.fn(() => ({
          release: () => observedSessionCounts.push(manager.getSessionCount()),
        })),
      },
    )
    for (const terminalSessionId of ['term-batch-session-11111', 'term-batch-session-22222']) {
      const prepared = manager.prepareSession({
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId,
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: WORKTREE_PATH,
      })
      if (!prepared.ok) throw new Error(prepared.message)
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      })
    }

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(observedSessionCounts).toEqual([0, 0])
  })

  test('revokes invalidated PTY output ownership before releasing runtime retention', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const release = vi.fn(() => supervisor.emitData('pty_initial_123456', 'output during runtime release'))
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { onOutput, onExit: vi.fn(), withRetirementTabsSnapshot: noRetirementTabsSnapshot },
      () => true,
      {
        retain: vi.fn(() => ({ release })),
      },
    )
    await createSession(manager, supervisor)
    onOutput.mockClear()

    manager.commitWorkspaceRuntimeSessionInvalidation(USER_ID, SCOPE)

    expect(release).toHaveBeenCalledOnce()
    expect(onOutput).not.toHaveBeenCalled()
  })

  test('supersedes an older restart before spawning the latest replacement', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_123'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalSize: { cols: 120, rows: 40 },
    })

    expect(supervisor.killed).toEqual(['pty_initial_123456'])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId }),
    ])

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_restart_two_123'])
  })

  test('publishes only the latest restart failure when an older restart is superseded', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.({ ok: false, message: 'new restart failed' })

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toEqual({ ok: false, message: 'new restart failed' })

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: created.terminalRuntimeGeneration,
        phase: 'error',
        message: 'new restart failed',
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])
  })

  test('does not publish a replacement after the requesting controller expires during spawn', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))

    manager.expireClientAttachments(USER_ID, CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_expired_restart_123'))

    await expect(restart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeSessionId: created.terminalRuntimeSessionId,
        terminalRuntimeGeneration: created.terminalRuntimeGeneration,
        canonicalSize: { cols: 80, rows: 24 },
      }),
    ])
    expect(supervisor.killed).toEqual(['pty_initial_123456', 'pty_expired_restart_123'])
  })

  test('does not adopt a replacement PTY whose spawn resolves after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const restart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_close_race_123'))
    const close = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)

    await expect(restart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(supervisor.killed).toContain('pty_restart_close_race_123')
  })

  test('rejects an attach fenced to the retired generation after a superseding restart', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const created = await createSession(manager, supervisor)

    const firstRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const attach = manager.attachSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      100,
      30,
      CLIENT_ID,
    )
    const secondRestart = manager.restartSession(
      USER_ID,
      created.terminalRuntimeSessionId,
      created.terminalRuntimeGeneration,
      120,
      40,
      CLIENT_ID,
    )

    await vi.waitFor(() => expect(supervisor.spawns).toHaveLength(1))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_restart_two_789'))

    await expect(firstRestart).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(secondRestart).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeSessionId: created.terminalRuntimeSessionId,
      canonicalSize: { cols: 120, rows: 40 },
    })
    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
  })
})
