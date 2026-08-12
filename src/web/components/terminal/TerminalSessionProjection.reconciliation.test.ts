// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/terminal-session-projection.ts'
import {
  requiredTerminalSession,
  terminalSessionProjectionAccess,
} from '#/web/test-utils/terminal-session-projection-access.ts'
import {
  BRANCH,
  REPO_ROOT,
  RUNTIME_TARGET,
  WORKSPACE_RUNTIME_ID,
  WORKTREE_KEY,
  makeDescriptor,
  makeRuntimeMembershipIndex,
  makeServerSession,
  projection,
  selectedChanges,
  sessionClosedEvent,
  successfulRuntimeCloseSnapshot,
  tabsBeforeRetirement,
  workspacePaneRuntimeMocks,
  workspacePaneTabsCommitMocks,
} from '#/web/test-utils/terminal-session-projection.ts'

describe('TerminalSessionProjection reconciliation', () => {
  test('creates missing local sessions and syncs selection', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    const snapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    expect(snapshot.count).toBe(1)
    expect(snapshot.sessions[0]!.terminalSessionId).toBe('term-111111111111111111111')
    expect(selectedChanges).toContainEqual({
      terminalFilesystemTargetKey: WORKTREE_KEY,
      terminalSessionId: snapshot.sessions[0]!.terminalSessionId,
    })
  })

  test('applies a preferred selection after its session materializes', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.setPreferredSelectedTerminalSessionIds({
      [WORKTREE_KEY]: 'term-111111111111111111111',
    })

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222', {
          controller: { clientId: 'client_local', status: 'connected' },
        }),
      ],
      'client_local',
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      'term-111111111111111111111',
    )
  })

  test('removes local sessions absent from the authoritative catalog', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    terminalSessionProjectionAccess(projection).ensureSession(makeDescriptor('term-111111111111111111111', 1))
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [],
      'client_local',
    )

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

    let settled = false
    const closePromise = projection
      .closeTerminalByDescriptor(terminalSessionId, {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      })
      .then((result) => {
        settled = true
        return result
      })
    await Promise.resolve()

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      terminalSessionId,
    )
    expect(settled).toBe(false)

    serverClose.resolve(successfulRuntimeCloseSnapshot())
    await expect(closePromise).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(settled).toBe(true)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('keeps command-closing sessions visible when server reconciliation removes them before close settles', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

    const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    expect(
      projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
    ).toEqual([terminalSessionId])

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [],
      'client_local',
    )

    expect(
      projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
    ).toEqual([terminalSessionId])

    serverClose.resolve(successfulRuntimeCloseSnapshot())
    await expect(closePromise).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('keeps command-closing sessions visible when a session-closed event arrives before close settles', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

    const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()
    const retirement = vi.fn()
    projection.subscribeAcceptedRetirement(retirement)

    projection.handleSessionClosed(sessionClosedEvent('pty_session_1_aaaaaaaaa', 1, terminalSessionId))

    expect(
      projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((summary) => summary.terminalSessionId),
    ).toEqual([terminalSessionId])
    expect(retirement).not.toHaveBeenCalled()

    serverClose.resolve(successfulRuntimeCloseSnapshot())
    await expect(closePromise).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('ignores a stale session-closed event after the durable terminal rebinds', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_2_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )

    projection.handleSessionClosed(sessionClosedEvent('pty_session_1_aaaaaaaaa', 1, 'term-111111111111111111111'))

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    projection.handleSessionClosed(sessionClosedEvent('pty_session_2_aaaaaaaaa', 1, 'term-111111111111111111111'))
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('uses the canonical durable session for an exact close', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const countsAtRetirement: number[] = []
    projection.subscribeAcceptedRetirement(() => {
      countsAtRetirement.push(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count)
    })
    projection.handleSessionClosed(
      sessionClosedEvent(
        'pty_session_1_aaaaaaaaa',
        1,
        'term-111111111111111111111',
        tabsBeforeRetirement('term-111111111111111111111'),
      ),
    )

    expect(countsAtRetirement).toEqual([1])
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('keeps a rebound runtime when an older command close settles', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
      'client_local',
    )
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
    const close = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId)],
      'client_local',
    )
    serverClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))

    await expect(close).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    expect(requiredTerminalSession(projection, terminalSessionId)?.currentTerminalRuntimeSessionId()).toBe(
      'pty_session_2_aaaaaaaaa',
    )
  })

  test('does not reuse a pending close across workspace runtime epochs', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const replacementWorkspaceRuntimeId = 'repo-runtime-replacement'
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
      'client_local',
    )
    const firstServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    const secondServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close
      .mockReturnValueOnce(firstServerClose.promise)
      .mockReturnValueOnce(secondServerClose.promise)

    const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex(replacementWorkspaceRuntimeId))
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: replacementWorkspaceRuntimeId },
      [
        makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId, {
          workspaceRuntimeId: replacementWorkspaceRuntimeId,
        }),
      ],
      'client_local',
    )
    const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: { ...RUNTIME_TARGET, workspaceRuntimeId: replacementWorkspaceRuntimeId },
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(2)
    firstServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))
    await expect(firstClose).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    secondServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_2_aaaaaaaaa'))
    await expect(secondClose).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalByDescriptor selects an adjacent terminal after server close settles', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
      ],
      'client_local',
    )

    const activeSessionId = projection
      .terminalFilesystemTargetSnapshot(WORKTREE_KEY)
      .sessions.find((session) => session.terminalSessionId === 'term-222222222222222222222')?.terminalSessionId
    if (!activeSessionId) throw new Error('missing term-222222222222222222222')
    projection.selectTerminal(WORKTREE_KEY, activeSessionId)
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

    const closePromise = projection.closeTerminalByDescriptor(activeSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    const closingSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    expect(closingSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
      'term-111111111111111111111',
      'term-222222222222222222222',
      'term-333333333333333333333',
    ])
    expect(closingSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-222222222222222222222')

    serverClose.resolve(successfulRuntimeCloseSnapshot(activeSessionId, 'pty_session_2_aaaaaaaaa'))
    await expect(closePromise).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    const closedSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    expect(closedSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
      'term-111111111111111111111',
      'term-333333333333333333333',
    ])
    expect(closedSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-333333333333333333333')
  })

  test('commits the close response snapshot before applying its exact terminal effect', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
      ],
      'client_local',
    )
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce(
      successfulRuntimeCloseSnapshot('term-111111111111111111111', 'pty_session_1_aaaaaaaaa'),
    )

    await expect(
      projection.closeTerminalByDescriptor('term-111111111111111111111', {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'committed', projection: 'applied' })

    expect(workspacePaneTabsCommitMocks.writeCanonicalSnapshot).toHaveBeenCalledWith(REPO_ROOT, WORKSPACE_RUNTIME_ID, {
      revision: 7,
      entries: [],
    })
    expect(
      projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
    ).toEqual(['term-222222222222222222222'])
  })

  test('keeps the terminal close while stopping presentation for a rejected runtime scope', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce(successfulRuntimeCloseSnapshot())
    workspacePaneTabsCommitMocks.writeCanonicalSnapshot.mockReturnValueOnce('scope-rejected')

    await expect(
      projection.closeTerminalByDescriptor('term-111111111111111111111', {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'committed', projection: 'superseded' })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('continues close presentation when a newer pane snapshot is already cached', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce(successfulRuntimeCloseSnapshot())
    workspacePaneTabsCommitMocks.writeCanonicalSnapshot.mockReturnValueOnce('newer-snapshot-preserved')
    workspacePaneTabsCommitMocks.tabsAfterSnapshotCommit.mockReturnValueOnce([
      { type: 'status', tabId: 'workspace-pane:status' },
      { type: 'history', tabId: 'workspace-pane:history' },
    ])

    await expect(
      projection.closeTerminalByDescriptor('term-111111111111111111111', {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'committed', projection: 'applied' })
  })

  test('stops close presentation when a newer snapshot contains the terminal again', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce(successfulRuntimeCloseSnapshot())
    workspacePaneTabsCommitMocks.writeCanonicalSnapshot.mockReturnValueOnce('newer-snapshot-preserved')
    workspacePaneTabsCommitMocks.tabsAfterSnapshotCommit.mockReturnValueOnce([
      { type: 'terminal', runtimeSessionId: 'term-111111111111111111111' },
    ])

    await expect(
      projection.closeTerminalByDescriptor('term-111111111111111111111', {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'committed', projection: 'superseded' })
  })

  test('applies a committed terminal close when pane projection recovery was invalidated', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce({
      ...successfulRuntimeCloseSnapshot(),
      paneTabsSnapshot: null,
    })

    await expect(
      projection.closeTerminalByDescriptor('term-111111111111111111111', {
        target: RUNTIME_TARGET,
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'committed', projection: 'failed' })

    expect(workspacePaneTabsCommitMocks.writeCanonicalSnapshot).not.toHaveBeenCalled()
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalByDescriptor deduplicates repeated closes for the same terminal session', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

    const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(1)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    serverClose.resolve(successfulRuntimeCloseSnapshot())
    await expect(firstClose).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    await expect(secondClose).resolves.toEqual({ kind: 'committed', projection: 'applied' })
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    const session = requiredTerminalSession(projection, terminalSessionId)
    const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
    workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
    const dispose = vi.spyOn(session, 'dispose')

    const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
      target: RUNTIME_TARGET,
      presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
    })
    await Promise.resolve()

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)

    const expectation = expect(closePromise).rejects.toThrow('close failed')
    serverClose.reject(new Error('close failed'))
    await expectation

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      'term-111111111111111111111',
    )
    expect(dispose).not.toHaveBeenCalled()
  })

  test('closeTerminalByDescriptor rejects a mismatched workspace runtime scope', async () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    const terminalSessionId = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
    workspacePaneRuntimeMocks.close.mockResolvedValueOnce({
      ok: false,
      runtimeType: 'terminal',
      message: 'error.workspace-runtime-stale',
    })

    await expect(
      projection.closeTerminalByDescriptor(terminalSessionId, {
        target: { ...RUNTIME_TARGET, workspaceRuntimeId: 'repo-runtime-new' },
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH } },
      }),
    ).resolves.toEqual({ kind: 'not-committed' as const, message: 'error.workspace-runtime-stale' })

    expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledOnce()
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).count).toBe(1)
  })

  test('preserves current selection and falls back to controller when current is lost', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

    // First reconcile: term-111111111111111111111 becomes current
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
      'client_local',
    )
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      'term-111111111111111111111',
    )

    // Second reconcile: term-111111111111111111111 removed, term-222222222222222222222 is controller
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222', {
          controller: { clientId: 'client_local', status: 'connected' },
        }),
      ],
      'client_local',
    )
    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      'term-222222222222222222222',
    )
  })

  test('closing the active terminal selects the adjacent tab in the server session list', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
      ],
      'client_local',
    )

    const snapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    const activeSessionId = snapshot.sessions.find(
      (session) => session.terminalSessionId === 'term-222222222222222222222',
    )?.terminalSessionId
    if (!activeSessionId) throw new Error('missing term-222222222222222222222')

    projection.selectTerminal(WORKTREE_KEY, activeSessionId)
    terminalSessionProjectionAccess(projection).removeSession(activeSessionId, { dispose: false })

    expect(projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
      'term-111111111111111111111',
    )
  })

  test('invalidates cached filesystem target snapshot when the server session list changes', () => {
    projection.setRuntimeMembershipIndex(makeRuntimeMembershipIndex())
    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
      ],
      'client_local',
    )

    const firstSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    expect(firstSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
      'term-111111111111111111111',
      'term-222222222222222222222',
    ])

    projection.reconcileServerSessions(
      { workspaceId: REPO_ROOT, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      [
        makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
      ],
      'client_local',
    )

    const secondSnapshot = projection.terminalFilesystemTargetSnapshot(WORKTREE_KEY)
    expect(secondSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
      'term-222222222222222222222',
      'term-111111111111111111111',
    ])
  })
})
