import { describe, expect, test, vi } from 'vitest'
import type { TerminalSessionSummary, TerminalSessionsSnapshot } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { PtyHandle } from '#/server/terminal/pty-supervisor.ts'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'
import {
  BRANCH_NAME,
  CLIENT_ID,
  SCOPE,
  TERMINAL_SESSION_ID,
  USER_ID,
  WORKSPACE_ID,
  WORKTREE_PATH,
  WORKTREE_TARGET,
  createAlwaysOnlineManager,
  createDeferredPtySupervisor,
  createManagerWithPresence,
  createSession,
  noRetirementTabsSnapshot,
  ptySpawnSuccess,
  tabsBeforeRetirement,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager session lifecycle', () => {
  test('rejects an existing admission after the PTY exits during placement preparation', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    await createSession(manager, supervisor)

    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!admission.ok) throw new Error(admission.message)
    onIdentity.mockClear()

    supervisor.emitExit('pty_initial_123456')

    expect(() =>
      admission.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.unavailable')
    admission.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
  })

  test('detaches and disposes a naturally exited session when lifecycle publication throws', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onLifecycle = vi.fn()
    const onSessionClosed = vi.fn()
    const onOutput = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onLifecycle, onSessionClosed, onOutput })
    const created = await createSession(manager, supervisor)
    onLifecycle.mockImplementation(() => {
      throw new Error('publication failed')
    })
    onOutput.mockClear()

    expect(() => supervisor.emitExit('pty_initial_123456')).not.toThrow()

    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onSessionClosed).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ terminalRuntimeSessionId: created.terminalRuntimeSessionId, phase: 'closed' }),
      'session',
    )
    supervisor.emitData('pty_initial_123456', 'late output')
    expect(onOutput).not.toHaveBeenCalled()
  })

  test('publishes natural exit with the canonical tabs before-state', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onExit = vi.fn()
    const tabs = tabsBeforeRetirement()
    const withRetirementTabsSnapshot = vi.fn(
      async (
        _userId: string,
        _session: TerminalSessionSummary,
        commit: (tabsBeforeRetirement: WorkspacePaneTabEntry[] | null) => undefined,
      ) => {
        commit(tabs)
      },
    )
    const manager = createAlwaysOnlineManager(supervisor, { onExit, withRetirementTabsSnapshot })
    const created = await createSession(manager, supervisor)

    supervisor.emitExit('pty_initial_123456')

    await vi.waitFor(() =>
      expect(onExit).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          terminalRuntimeSessionId: created.terminalRuntimeSessionId,
          tabsBeforeRetirement: tabs,
        }),
      ),
    )
    expect(withRetirementTabsSnapshot).toHaveBeenCalledOnce()
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })

  test('returns the canonical tabs before-state from an explicit close', async () => {
    const supervisor = createDeferredPtySupervisor()
    const tabs = tabsBeforeRetirement()
    const manager = createAlwaysOnlineManager(supervisor, {
      withRetirementTabsSnapshot: async (_userId, _session, commit) => {
        commit(tabs)
      },
    })
    const created = await createSession(manager, supervisor)

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
      tabsBeforeRetirement: tabs,
    })
  })

  test('rejects an existing admission while retirement is in progress', async () => {
    let finishRetirement: (() => void) | undefined
    const supervisor = createDeferredPtySupervisor()
    supervisor.killAndWait = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          finishRetirement = resolve
        }),
    )
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const created = await createSession(manager, supervisor)
    const admission = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!admission.ok) throw new Error(admission.message)
    onIdentity.mockClear()

    const retirement = manager.requestSessionRetirement(created.terminalRuntimeSessionId)

    expect(() =>
      admission.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.unavailable')
    admission.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(finishRetirement).toBeTypeOf('function'))
    finishRetirement?.()
    await expect(retirement).resolves.toBe(true)
    await expect(manager.requestSessionRetirement(created.terminalRuntimeSessionId)).resolves.toBe(false)
  })

  test('retains the exact workspace runtime until the terminal session is detached', async () => {
    const supervisor = createDeferredPtySupervisor()
    const release = vi.fn()
    const retentions = {
      retain: vi.fn(() => ({ release })),
    }
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn() },
      () => true,
      retentions,
    )
    const created = await createSession(manager, supervisor)

    expect(retentions.retain).toHaveBeenCalledOnce()
    expect(retentions.retain).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
      WORKTREE_TARGET.workspaceRuntimeId,
      created.terminalRuntimeSessionId,
    )
    expect(release).not.toHaveBeenCalled()

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(retentions.retain).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledOnce()
  })

  test('hands the workspace runtime retention to asynchronous close effects', async () => {
    const supervisor = createDeferredPtySupervisor()
    const closeEffect = Promise.withResolvers<void>()
    const release = vi.fn()
    const onSessionClosed = vi.fn(async () => await closeEffect.promise)
    const retain = vi.fn(() => ({ release }))
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn(), onSessionClosed },
      () => true,
      { retain },
    )
    const created = await createSession(manager, supervisor)

    const closing = manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)
    await vi.waitFor(() => expect(onSessionClosed).toHaveBeenCalledOnce())
    await expect(closing).resolves.toMatchObject({ kind: 'closed' })

    expect(retain).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
    closeEffect.resolve()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })

  test('releases the workspace runtime retention when close effects throw synchronously', async () => {
    const supervisor = createDeferredPtySupervisor()
    const release = vi.fn()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      {
        onOutput: vi.fn(),
        onExit: vi.fn(),
        withRetirementTabsSnapshot: noRetirementTabsSnapshot,
        onSessionClosed: vi.fn(() => {
          throw new Error('close effect failed')
        }),
      },
      () => true,
      { retain: vi.fn(() => ({ release })) },
    )
    const created = await createSession(manager, supervisor)

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(release).toHaveBeenCalledOnce()
  })

  test('releases the workspace runtime retention when asynchronous close effects reject', async () => {
    const supervisor = createDeferredPtySupervisor()
    const release = vi.fn()
    const closeEffect = Promise.withResolvers<void>()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      {
        onOutput: vi.fn(),
        onExit: vi.fn(),
        withRetirementTabsSnapshot: noRetirementTabsSnapshot,
        onSessionClosed: vi.fn(() => closeEffect.promise),
      },
      () => true,
      { retain: vi.fn(() => ({ release })) },
    )
    const created = await createSession(manager, supervisor)

    await expect(manager.closeSessionForUserOutcome(USER_ID, created.terminalRuntimeSessionId)).resolves.toMatchObject({
      kind: 'closed',
    })
    expect(release).not.toHaveBeenCalled()
    closeEffect.reject(new Error('close effect failed'))
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })

  test('releases the admission reservation when runtime retention rejects a stale generation', () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = new TerminalSessionManager<string>(
      supervisor,
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn() },
      () => true,
      {
        retain: vi.fn(() => {
          throw new Error('error.workspace-runtime-stale')
        }),
      },
    )
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok || prepared.admission.kind !== 'prepared') throw new Error('expected prepared admission')

    expect(() =>
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toThrow('error.workspace-runtime-stale')
    prepared.admission.abort()

    const retried = manager.prepareSession(input)
    expect(retried).toMatchObject({ ok: true, admission: { kind: 'prepared' } })
    if (retried.ok && retried.admission.kind === 'prepared') retried.admission.abort()
  })

  test('prepares without spawning, then starts at fitted geometry and snapshots only later attaches', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onOutput = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onOutput, onSessionsProjectionChanged })
    const siblingSnapshots: TerminalSessionsSnapshot[] = []
    onSessionsProjectionChanged.mockImplementation(() => {
      siblingSnapshots.push(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE))
    })
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
      command: '/bin/zsh',
      args: ['-l'],
      startupShellCommand: 'echo ready\r',
      env: { GOBLIN_TEST: '1' },
    })
    expect(prepared).toMatchObject({ ok: true })
    expect(supervisor.spawn).not.toHaveBeenCalled()
    if (!prepared.ok) return
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
    expect(
      prepared.admission.commit({
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
      }),
    ).toMatchObject({
      action: 'created',
      phase: 'opening',
      terminalRuntimeGeneration: 0,
    })
    expect(onSessionsProjectionChanged).not.toHaveBeenCalled()
    prepared.admission.publishCommittedEffects()
    expect(onSessionsProjectionChanged).toHaveBeenCalledOnce()
    expect(siblingSnapshots).toMatchObject([
      { revision: 1, sessions: [{ terminalRuntimeGeneration: 0, phase: 'opening' }] },
    ])

    const freshAttach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 123, 41, CLIENT_ID)
    expect(supervisor.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        command: '/bin/zsh',
        args: ['-l'],
        startupShellCommand: 'echo ready\r',
        cwd: '/tmp',
        cols: 123,
        rows: 41,
        env: { GOBLIN_TEST: '1' },
      }),
    )
    const freshSpawn = ptySpawnSuccess('pty_fresh_stream_123456')
    supervisor.emitData('pty_fresh_stream_123456', 'early prompt')
    supervisor.spawns.shift()?.(freshSpawn)
    await expect(freshAttach).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      terminalProjectionEffect: { kind: 'delta', revision: 2 },
      canonicalSize: { cols: 123, rows: 41 },
    })
    expect(onSessionsProjectionChanged).toHaveBeenCalledTimes(2)
    expect(onSessionsProjectionChanged).toHaveBeenLastCalledWith(USER_ID, {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 2,
    })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toMatchObject({
      revision: 2,
      sessions: [{ terminalRuntimeGeneration: 1, phase: 'open' }],
    })
    expect(siblingSnapshots).toMatchObject([
      { revision: 1, sessions: [{ terminalRuntimeGeneration: 0, phase: 'opening' }] },
      { revision: 2, sessions: [{ terminalRuntimeGeneration: 1, phase: 'open' }] },
    ])
    expect(onOutput).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        terminalRuntimeGeneration: 1,
        data: 'early prompt',
        seq: 1,
      }),
    )

    await expect(
      manager.writeSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 'stale input', CLIENT_ID),
    ).resolves.toEqual({ status: 'rejected' })
    await expect(
      manager.writeSession(USER_ID, prepared.terminalRuntimeSessionId, 1, 'input before output', CLIENT_ID),
    ).resolves.toEqual({ status: 'accepted' })

    supervisor.emitData('pty_fresh_stream_123456', 'prompt')
    expect(onOutput).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ data: 'prompt', seq: 2 }))
    const recoveryAttach = await manager.attachSession(
      USER_ID,
      prepared.terminalRuntimeSessionId,
      1,
      123,
      41,
      CLIENT_ID,
    )
    expect(recoveryAttach).toMatchObject({
      ok: true,
      frame: 'snapshot',
      snapshot: 'early promptprompt',
      snapshotSeq: 2,
    })
  })

  test('does not commit a fresh binding whose native spawn resolves after close admission', async () => {
    const supervisor = createDeferredPtySupervisor()
    const onIdentity = vi.fn()
    const manager = createAlwaysOnlineManager(supervisor, { onIdentity })
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const attach = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_fresh_close_race_123'))
    const close = manager.closeSessionForUserOutcome(USER_ID, prepared.terminalRuntimeSessionId)

    await expect(attach).resolves.toEqual({ ok: false, message: 'error.unavailable' })
    await expect(close).resolves.toMatchObject({ kind: 'closed' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
    expect(onIdentity).not.toHaveBeenCalled()
  })

  test('publishes a failed candidate retirement as a fresh attach error and drains it before retry', async () => {
    const supervisor = createDeferredPtySupervisor()
    const retryKillAcknowledged = Promise.withResolvers<void>()
    const offlineClients = new Set<string>()
    supervisor.killAndWait = vi
      .fn<(handle: PtyHandle) => Promise<void>>()
      .mockRejectedValueOnce(new Error('PTY close timed out'))
      .mockImplementationOnce(async () => await retryKillAcknowledged.promise)
    const manager = createManagerWithPresence(supervisor, {}, (clientId) => !offlineClients.has(clientId))
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const first = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    offlineClients.add(CLIENT_ID)
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_rejected_fresh_candidate_123'))

    await expect(first).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([
      expect.objectContaining({
        terminalRuntimeGeneration: 0,
        phase: 'error',
        message: 'PTY close timed out',
        canonicalSize: null,
      }),
    ])

    const retry = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 120, 40, 'client-retry')
    await vi.waitFor(() => expect(supervisor.killAndWait).toHaveBeenCalledTimes(2))
    expect(supervisor.spawn).toHaveBeenCalledOnce()

    retryKillAcknowledged.resolve()
    await vi.waitFor(() => expect(supervisor.spawn).toHaveBeenCalledTimes(2))
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_fresh_after_retirement_123'))
    await expect(retry).resolves.toMatchObject({
      ok: true,
      frame: 'stream',
      terminalRuntimeGeneration: 1,
      canonicalSize: { cols: 120, rows: 40 },
    })
  })

  test('gives a concurrent later attach a snapshot after the fresh spawn completes', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    prepared.admission.commit({
      presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: BRANCH_NAME } },
    })
    prepared.admission.publishCommittedEffects()

    const first = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 100, 30, CLIENT_ID)
    const second = manager.attachSession(USER_ID, prepared.terminalRuntimeSessionId, 0, 120, 40, 'client-test-2')
    supervisor.spawns.shift()?.(ptySpawnSuccess('pty_concurrent_attach_123'))

    await expect(first).resolves.toMatchObject({ ok: true, frame: 'stream' })
    await expect(second).resolves.toMatchObject({
      ok: true,
      frame: 'snapshot',
      snapshot: '',
      snapshotSeq: 0,
    })
    expect(supervisor.spawn).toHaveBeenCalledOnce()
  })

  test('closes a prepared session without ever allocating a PTY', async () => {
    const supervisor = createDeferredPtySupervisor()
    const manager = createAlwaysOnlineManager(supervisor)
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)

    expect(manager.primaryTerminalSessionIdForFilesystemTarget(USER_ID, SCOPE, WORKSPACE_ID)).toBeNull()

    await expect(manager.closeSessionForUserOutcome(USER_ID, prepared.terminalRuntimeSessionId)).resolves.toEqual({
      kind: 'already-closed',
    })
    if (prepared.admission.kind === 'prepared') prepared.admission.abort()
    expect(supervisor.spawn).not.toHaveBeenCalled()
    expect(supervisor.killed).toEqual([])
    await expect(manager.listSessionsForUser(USER_ID, SCOPE)).resolves.toEqual([])
  })
})
