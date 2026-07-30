// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { runtimeMembershipIndexFromEntries } from '#/web/components/terminal/terminal-runtime-membership-index.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'
import {
  REPO_ROOT,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  makeRuntimeMembershipIndex,
  makeServerSession,
  projection,
  sessionClosedEvent,
  tabsBeforeRetirement,
} from '#/web/test-utils/terminal-session-projection.ts'

describe('TerminalSessionProjection events', () => {
  test('rejects reconciliation for a workspace runtime outside the current repo index', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

    const reconciled = projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: 'repo-runtime-old' },
      [
        makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
          workspaceRuntimeId: 'repo-runtime-old',
        }),
      ],
      'client_local',
    )

    expect(reconciled).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('rejects older snapshots without evicting the accepted projection', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    expect(
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        {
          revision: 2,
          sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        },
        'client_local',
      ),
    ).toBe(true)

    expect(
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { revision: 1, sessions: [] },
        'client_local',
      ),
    ).toBe(false)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('accepts equal revisions for metadata refresh and higher revisions for removal', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
    projection.reconcileServerSessionsSnapshot(
      scope,
      {
        revision: 2,
        sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      },
      'client_local',
    )

    expect(
      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 2,
          sessions: [
            makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
              processName: 'node',
              canonicalTitle: 'build',
            }),
          ],
        },
        'client_local',
      ),
    ).toBe(true)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]).toMatchObject({
      processName: 'node',
      originalTitle: 'build',
    })

    expect(projection.reconcileServerSessionsSnapshot(scope, { revision: 3, sessions: [] }, 'client_local')).toBe(true)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('does not turn a gapped partial session delta into full catalog coverage', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
    const sessionA = makeServerSession('pty_delta_a_aaaaaaaaaaaa', 'term-111111111111111111111')
    const sessionB = makeServerSession('pty_delta_b_aaaaaaaaaaaa', 'term-222222222222222222222')
    projection.reconcileServerSessionsSnapshot(scope, { revision: 1, sessions: [sessionA] }, 'client_local')

    expect(
      terminalSessionProjectionAccess(projection).applyServerSessionEffect(
        scope,
        { kind: 'delta', revision: 3 },
        sessionA,
        'client_local',
      ),
    ).toBe(true)
    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(1)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    projection.reconcileServerSessionsSnapshot(scope, { revision: 3, sessions: [sessionA, sessionB] }, 'client_local')
    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(3)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(2)
  })

  test('advances catalog coverage for one continuous origin delta but not across a gap', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const scope = { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID }
    projection.reconcileServerSessionsSnapshot(scope, { revision: 1, sessions: [] }, 'client_local')

    expect(projection.applyTerminalSessionsDeltaRevision(scope, 2)).toBe(true)
    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
    expect(projection.applyTerminalSessionsDeltaRevision(scope, 4)).toBe(true)
    expect(projection.terminalSessionsCatalogCoverageRevision(scope)).toBe(2)
  })

  test('uses a fresh revision epoch for a replacement workspace runtime and after destroy', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessionsSnapshot(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      { revision: 10, sessions: [] },
      'client_local',
    )
    const replacementRuntimeId = 'repo-runtime-replacement'
    projection.setRuntimeMembershipIndex(
      runtimeMembershipIndexFromEntries([{ id: REPO_ROOT, workspaceRuntimeId: replacementRuntimeId }]),
    )
    expect(
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: replacementRuntimeId },
        {
          revision: 1,
          sessions: [
            makeServerSession('pty_session_b_aaaaaaaaa', 'term-222222222222222222222', {
              workspaceRuntimeId: replacementRuntimeId,
            }),
          ],
        },
        'client_local',
      ),
    ).toBe(true)

    projection.destroy()
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    expect(
      projection.reconcileServerSessionsSnapshot(
        { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        { revision: 1, sessions: [] },
        'client_local',
      ),
    ).toBe(true)
  })

  test('does not publish retirement presentation without an active local binding', () => {
    const terminalSessionId = 'term-111111111111111111111'
    const listener = vi.fn()
    projection.subscribeAcceptedRetirement(listener)
    const presentation = tabsBeforeRetirement(terminalSessionId)

    projection.handleExit({
      terminalRuntimeSessionId: 'pty_session_absent_aaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: presentation,
    })
    projection.handleSessionClosed(sessionClosedEvent('pty_session_absent_aaaaaa', 1, terminalSessionId, presentation))

    expect(listener).not.toHaveBeenCalled()
  })

  test('publishes an accepted PTY exit before removing its local session projection', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const terminalSessionId = 'term-111111111111111111111'
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', terminalSessionId)],
      'client_local',
    )
    const observedCounts: number[] = []
    const offExit = projection.subscribeAcceptedRetirement((retirement) => {
      expect(retirement.terminalSessionId).toBe(terminalSessionId)
      expect(retirement.tabsBeforeRetirement).toEqual(tabsBeforeRetirement(terminalSessionId))
      observedCounts.push(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count)
    })

    projection.handleExit({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: tabsBeforeRetirement(terminalSessionId),
    })

    expect(observedCounts).toEqual([1])
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
    offExit()
  })

  test('does not route realtime events through another session runtime binding', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const session = requiredTerminalSession(projection, 'term-111111111111111111111')
    const handleOutputSpy = vi.spyOn(session, 'handleOutput')
    const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')
    const handleExitSpy = vi.spyOn(session, 'handleExit')
    const handleIdentitySpy = vi.spyOn(session, 'handleIdentity')
    const handleLifecycleSpy = vi.spyOn(session, 'handleLifecycle')
    const contradictoryIdentity = {
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-222222222222222222222',
    }

    projection.handleOutput({
      ...contradictoryIdentity,
      data: 'must not be routed',
      seq: 1,
      processName: 'bash',
    })
    projection.handleServerBell({
      ...contradictoryIdentity,
      workspaceId: REPO_ROOT,
      processName: 'bash',
      canonicalTitle: null,
    })
    projection.handleServerTitle({
      ...contradictoryIdentity,
      workspaceId: REPO_ROOT,
      canonicalTitle: 'must not be routed',
    })
    projection.handleExit({
      ...contradictoryIdentity,
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })
    projection.handleIdentity({
      ...contradictoryIdentity,
      identityRevision: 1,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    projection.handleLifecycle({
      ...contradictoryIdentity,
      phase: 'open',
      message: null,
    })
    projection.handleSessionClosed(
      sessionClosedEvent(
        contradictoryIdentity.terminalRuntimeSessionId,
        contradictoryIdentity.terminalRuntimeGeneration,
        contradictoryIdentity.terminalSessionId,
      ),
    )

    expect(handleOutputSpy).not.toHaveBeenCalled()
    expect(handleServerTitleSpy).not.toHaveBeenCalled()
    expect(handleExitSpy).not.toHaveBeenCalled()
    expect(handleIdentitySpy).not.toHaveBeenCalled()
    expect(handleLifecycleSpy).not.toHaveBeenCalled()
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).bellCount).toBe(0)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions).toHaveLength(1)
  })

  test('dispatches output by canonical terminalSessionId and validates its runtime binding', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalFilesystemTargetSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    const terminalSessionId = terminalFilesystemTargetSnapshot.sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleOutputSpy = vi.spyOn(session, 'handleOutput')

    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'hello',
      seq: 1,
      processName: 'bash',
    })
    expect(handleOutputSpy).toHaveBeenCalledTimes(1)

    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'hello',
      seq: 1,
      processName: 'bash',
    })
    expect(handleOutputSpy).toHaveBeenCalledTimes(1)
  })

  test('does not mark empty output payloads as terminal output activity', () => {
    useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleOutputSpy = vi.spyOn(session, 'handleOutput')

    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: '',
      seq: 1,
      processName: 'bash',
    })
    vi.advanceTimersByTime(5000)
    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: '',
      seq: 2,
      processName: 'bash',
    })

    expect(handleOutputSpy).toHaveBeenCalledTimes(2)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
  })

  test('does not mark stale output payloads as terminal output activity', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleOutputSpy = vi.spyOn(session, 'handleOutput')

    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'stale output',
      seq: 1,
      processName: 'bash',
    })

    expect(handleOutputSpy).not.toHaveBeenCalled()
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
  })

  test('rejects title changes whose canonical terminalSessionId does not resolve', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

    projection.handleServerTitle({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unroutedunroutedroute',
      workspaceId: REPO_ROOT,
      canonicalTitle: 'new title',
    })
    expect(handleServerTitleSpy).not.toHaveBeenCalled()

    handleServerTitleSpy.mockClear()
    projection.handleServerTitle({
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unroutedunroutedroute',
      workspaceId: REPO_ROOT,
      canonicalTitle: 'ignored',
    })
    expect(handleServerTitleSpy).not.toHaveBeenCalled()
  })

  test('dispatches title changes by canonical terminalSessionId', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')
    projection.handleServerTitle({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      canonicalTitle: 'new title',
    })
    expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')
  })

  test('ignores stale title changes for an old terminalRuntimeSessionId on the same terminalSessionId', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

    projection.handleServerTitle({
      terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      canonicalTitle: 'stale title',
    })
    expect(handleServerTitleSpy).not.toHaveBeenCalled()
  })

  test('rejects exit whose canonical terminalSessionId does not resolve', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

    projection.handleExit({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unroutedunroutedroute',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })
    expect(handleExitSpy).not.toHaveBeenCalled()

    handleExitSpy.mockClear()
    projection.handleExit({
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-unroutedunroutedroute',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })
    expect(handleExitSpy).not.toHaveBeenCalled()
  })

  test('routes output, exit, identity, and lifecycle by canonical terminalSessionId', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const handleOutputSpy = vi.spyOn(session, 'handleOutput')
    const handleIdentitySpy = vi.spyOn(session, 'handleIdentity')
    const handleLifecycleSpy = vi.spyOn(session, 'handleLifecycle')
    const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)
    projection.handleOutput({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      data: 'hello',
      seq: 1,
      processName: 'bash',
    })
    expect(handleOutputSpy).toHaveBeenCalledTimes(1)

    projection.handleIdentity({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      identityRevision: 1,
      terminalSessionId: 'term-111111111111111111111',
      role: 'controller',
      controllerStatus: 'connected',
      canonicalSize: { cols: 100, rows: 30 },
    })
    expect(handleIdentitySpy).toHaveBeenCalledTimes(1)

    projection.handleLifecycle({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      phase: 'open',
      message: null,
    })
    expect(handleLifecycleSpy).toHaveBeenCalledTimes(1)

    projection.handleExit({
      terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      workspaceId: REPO_ROOT,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      tabsBeforeRetirement: null,
    })
    expect(handleExitSpy).toHaveBeenCalledTimes(1)
  })

  test('clears a background terminal bell when that terminal is selected', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_b_aaaaaaaaa', 'term-222222222222222222222'),
      ],
      'client_local',
    )
    projection.selectTerminal(WORKTREE_KEY, 'term-111111111111111111111')

    projection.handleServerBell({
      terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-222222222222222222222',
      workspaceId: REPO_ROOT,
      processName: 'bash',
      canonicalTitle: null,
    })
    expect(
      projection
        .terminalFilesystemTargetSnapshot(WORKTREE_KEY)
        .sessions.find((session) => session.terminalSessionId === 'term-222222222222222222222')?.hasBell,
    ).toBe(true)

    projection.selectTerminal(WORKTREE_KEY, 'term-222222222222222222222')

    expect(
      projection
        .terminalFilesystemTargetSnapshot(WORKTREE_KEY)
        .sessions.find((session) => session.terminalSessionId === 'term-222222222222222222222'),
    ).toMatchObject({ selected: true, hasBell: false })
  })

  test('retains isolated Composer shells while selecting between terminal tabs', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    const firstSessionId = 'term-111111111111111111111'
    const secondSessionId = 'term-222222222222222222222'
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_a_aaaaaaaaa', firstSessionId),
        makeServerSession('pty_session_b_aaaaaaaaa', secondSessionId),
      ],
      'client_local',
    )

    projection.selectTerminal(WORKTREE_KEY, firstSessionId)
    expect(projection.setComposerExpanded(firstSessionId, true)).toBe(true)
    expect(projection.setComposerMode(firstSessionId, 'input')).toBe(true)

    projection.selectTerminal(WORKTREE_KEY, secondSessionId)
    expect(projection.snapshot(secondSessionId).composer).toEqual({
      expanded: false,
      mode: 'keys',
      historyEntries: [],
    })
    expect(projection.setComposerExpanded(secondSessionId, true)).toBe(true)

    projection.selectTerminal(WORKTREE_KEY, firstSessionId)
    expect(projection.snapshot(firstSessionId).composer).toEqual({
      expanded: true,
      mode: 'input',
      historyEntries: [],
    })
    expect(projection.snapshot(secondSessionId).composer).toEqual({
      expanded: true,
      mode: 'keys',
      historyEntries: [],
    })
  })

  test('notifySession invalidates filesystem target cache', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const listener = vi.fn()
    const unsubscribe = projection.subscribeTerminalFilesystemTarget(WORKTREE_KEY, listener)

    // Prime the cache
    projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    listener.mockClear()

    // Simulate metadata change via internal notifySession
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    terminalSessionProjectionAccess(projection).notifySession(terminalSessionId)

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  test('publishes Composer-only snapshots without activating bindings or invalidating filesystem targets', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const access = terminalSessionProjectionAccess(projection)
    const activateRuntimeBinding = vi.spyOn(access, 'activateRuntimeBinding')
    const snapshotListener = vi.fn()
    const filesystemTargetListener = vi.fn()
    const unsubscribeSnapshot = projection.subscribeSnapshot(terminalSessionId, snapshotListener)
    const unsubscribeFilesystemTarget = projection.subscribeTerminalFilesystemTarget(
      WORKTREE_KEY,
      filesystemTargetListener,
    )

    expect(projection.setComposerExpanded(terminalSessionId, true)).toBe(true)
    expect(projection.snapshot(terminalSessionId).composer.expanded).toBe(true)
    expect(snapshotListener).toHaveBeenCalledOnce()
    expect(filesystemTargetListener).not.toHaveBeenCalled()
    expect(activateRuntimeBinding).not.toHaveBeenCalled()

    snapshotListener.mockClear()
    expect(projection.setComposerExpanded(terminalSessionId, true)).toBe(true)
    expect(snapshotListener).not.toHaveBeenCalled()
    expect(projection.setComposerExpanded('missing-session', true)).toBe(false)

    unsubscribeSnapshot()
    unsubscribeFilesystemTarget()
  })

  test('destroys Composer state with logical session removal and creates no fallback state', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    expect(projection.setComposerExpanded(terminalSessionId, true)).toBe(true)

    expect(terminalSessionProjectionAccess(projection).removeSession(terminalSessionId, { dispose: true })).toBe(true)
    expect(projection.setComposerExpanded(terminalSessionId, false)).toBe(false)
    expect(projection.snapshot(terminalSessionId).composer).toEqual({
      expanded: false,
      mode: 'keys',
      historyEntries: [],
    })
  })
})
