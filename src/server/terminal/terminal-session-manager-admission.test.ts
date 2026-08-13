import { describe, expect, test, vi } from 'vitest'
import { TerminalSessionManager } from '#/server/terminal/terminal-session-manager.ts'
import { testPhysicalWorktreeExecutionCapability } from '#/server/test-utils/physical-worktree-identity.ts'

const EXPECTED_TERMINAL_SESSION_CAPACITY = 1024
import {
  BRANCH_NAME,
  SCOPE,
  TERMINAL_SESSION_ID,
  USER_ID,
  WORKTREE_PATH,
  WORKTREE_TARGET,
  createAlwaysOnlineManager,
  createDeferredPtySupervisor,
  createWorkspaceRuntimeRetentionHost,
  noRetirementTabsSnapshot,
  requiredWorkspaceLocator,
} from '#/server/test-utils/terminal-session-manager.ts'

describe('TerminalSessionManager admission', () => {
  test('reserves one global capacity slot per new session and releases an aborted reservation', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const admissions = Array.from({ length: EXPECTED_TERMINAL_SESSION_CAPACITY }, (_, index) =>
      manager.prepareSession({
        userId: `user-${index % 2}`,
        target: WORKTREE_TARGET,
        terminalSessionId: `terminal-${index}`,
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    )
    expect(admissions.every((admission) => admission.ok)).toBe(true)

    expect(
      manager.prepareSession({
        userId: 'another-user',
        target: WORKTREE_TARGET,
        terminalSessionId: 'terminal-over-limit',
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    ).toEqual({ ok: false, message: 'error.terminal-session-limit-reached' })

    const first = admissions[0]
    if (!first?.ok) throw new Error('expected a prepared terminal admission')
    first.admission.abort()

    expect(
      manager.prepareSession({
        userId: 'another-user',
        target: WORKTREE_TARGET,
        terminalSessionId: 'terminal-after-abort',
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    ).toMatchObject({ ok: true })
  })

  test('revokes prepared admissions when shutdown begins', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)

    manager.forceShutdown()

    expect(() =>
      prepared.admission.commit({
        presentation: { kind: 'git-worktree' },
      }),
    ).toThrow('error.unavailable')
    expect(
      manager.prepareSession({
        userId: USER_ID,
        target: WORKTREE_TARGET,
        terminalSessionId: 'terminal-after-shutdown',
        physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
        cwd: '/tmp',
      }),
    ).toEqual({ ok: false, message: 'error.unavailable' })
  })

  test('rejects target-incompatible presentation before committing prepared or existing sessions', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(() => prepared.admission.commit({ presentation: { kind: 'workspace-root' } })).toThrow(
      'error.invalid-arguments',
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])

    prepared.admission.commit({
      presentation: { kind: 'git-worktree' },
    })
    const baseline = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)
    const existing = manager.prepareSession(input)
    if (!existing.ok) throw new Error(existing.message)
    expect(() => existing.admission.commit({ presentation: { kind: 'workspace-root' } })).toThrow(
      'error.invalid-arguments',
    )
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)).toEqual(baseline)
  })

  test('prepares a session without sampling client presence', () => {
    let presenceFails = true
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
      createWorkspaceRuntimeRetentionHost(),
    )
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const prepared = manager.prepareSession(input)
    if (!prepared.ok) throw new Error(prepared.message)
    expect(
      prepared.admission.commit({
        presentation: { kind: 'git-worktree' },
      }),
    ).toMatchObject({
      action: 'created',
      terminalProjectionEffect: { kind: 'delta', revision: 1 },
    })
  })

  test('updates an existing presentation without sampling client presence', () => {
    let presenceFails = false
    const manager = new TerminalSessionManager<string>(
      createDeferredPtySupervisor(),
      { withRetirementTabsSnapshot: noRetirementTabsSnapshot, onOutput: vi.fn(), onExit: vi.fn() },
      () => {
        if (presenceFails) throw new Error('presence unavailable')
        return true
      },
      createWorkspaceRuntimeRetentionHost(),
    )
    const baseInput = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(baseInput)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree' },
    })
    presenceFails = true
    const existing = manager.prepareSession(baseInput)
    if (!existing.ok) throw new Error(existing.message)
    expect(
      existing.admission.commit({
        presentation: { kind: 'git-worktree' },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalProjectionEffect: { kind: 'none' },
    })
  })

  test('retires a prepared opening session before attach without leaving catalog membership', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const prepared = manager.prepareSession({
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    })
    if (!prepared.ok) throw new Error(prepared.message)
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toHaveLength(0)
    expect(prepared.admission.kind).toBe('prepared')
    if (prepared.admission.kind === 'prepared') prepared.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions).toEqual([])
  })

  test('defers an existing presentation mutation until placement admission commits', () => {
    const onIdentity = vi.fn()
    const onSessionsProjectionChanged = vi.fn()
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor(), {
      onIdentity,
      onSessionsProjectionChanged,
    })
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree' },
    })
    created.admission.publishCommittedEffects()
    onSessionsProjectionChanged.mockClear()

    const aborted = manager.prepareSession(input)
    if (!aborted.ok) throw new Error(aborted.message)
    expect(aborted).toMatchObject({ ok: true })
    aborted.admission.abort()
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).sessions[0]?.controller).toBeNull()

    const admitted = manager.prepareSession(input)
    if (!admitted.ok) throw new Error(admitted.message)
    const beforeRenameRevision = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision
    const committed = admitted.admission.commit({
      presentation: { kind: 'git-worktree' },
    })
    expect(committed).toMatchObject({ action: 'reused', controller: null, terminalProjectionEffect: { kind: 'none' } })
    const renamedSnapshot = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE)
    expect(renamedSnapshot.revision).toBe(beforeRenameRevision)
    expect(renamedSnapshot.sessions[0]?.controller).toBeNull()
    expect(onIdentity).not.toHaveBeenCalled()
    admitted.admission.publishCommittedEffects()
    expect(onIdentity).not.toHaveBeenCalled()
    expect(onSessionsProjectionChanged).not.toHaveBeenCalled()
    expect(renamedSnapshot.sessions[0]?.presentation).toEqual({
      kind: 'git-worktree',
    })
  })

  test('reports no catalog effect when reuse leaves presentation unchanged', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability: testPhysicalWorktreeExecutionCapability(WORKTREE_PATH),
      cwd: '/tmp',
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree' },
    })
    const beforeReuse = manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision

    const reused = manager.prepareSession(input)
    if (!reused.ok) throw new Error(reused.message)
    expect(
      reused.admission.commit({
        presentation: { kind: 'git-worktree' },
      }),
    ).toMatchObject({
      action: 'reused',
      terminalProjectionEffect: { kind: 'none' },
    })
    expect(manager.terminalSessionsSnapshotForUser(USER_ID, SCOPE).revision).toBe(beforeReuse)
  })

  test('rejects reuse under a different worktree path even with the same physical identity', () => {
    const manager = createAlwaysOnlineManager(createDeferredPtySupervisor())
    const physicalWorktreeCapability = testPhysicalWorktreeExecutionCapability(WORKTREE_PATH)
    const input = {
      userId: USER_ID,
      target: WORKTREE_TARGET,
      terminalSessionId: TERMINAL_SESSION_ID,
      physicalWorktreeCapability,
      cwd: '/tmp',
    }
    const created = manager.prepareSession(input)
    if (!created.ok) throw new Error(created.message)
    created.admission.commit({
      presentation: { kind: 'git-worktree' },
    })

    expect(
      manager.prepareSession({
        ...input,
        target: { ...WORKTREE_TARGET, root: requiredWorkspaceLocator('goblin+file:///repo/other-worktree') },
      }),
    ).toEqual({
      ok: false,
      message: 'error.invalid-arguments',
    })
  })
})
