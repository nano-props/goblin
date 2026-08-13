import {
  seedRepoWithReadModelForTest,
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/workspaces/types.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import {
  getRepoSnapshotQueryData,
  setRepoSnapshotQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import {
  REPO_ID,
  OTHER_WORKSPACE_ID,
  BRANCH_NAME,
  presentationOptions,
  WORKTREE_PATH,
  setupAppNavigationActionsTests,
  preferredWorkspacePaneTab,
  createAppNavigationActions,
  markRepoGitUnavailable,
  routeNavigation,
  createPendingWorktreeSnapshot,
  installTerminalSessionCommandBridgeForTest,
  worktreeSnapshotForSessions,
  WORKTREE_KEY,
  branchSelectionLease,
  worktreeSelectionLease,
} from '#/web/app-navigation-actions.test-utils.ts'
import { currentAppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'

beforeEach(setupAppNavigationActionsTests)

describe('createAppNavigationActions presentation', () => {
  test('presents a workspace-root tab through the workspace route and commits its preference', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    expect(actions.showWorkspaceRootPaneTab(REPO_ID, { kind: 'static', tab: 'files' })).toBe(true)
    expect(navigation.openWorkspaceRootTab).toHaveBeenCalledWith(
      REPO_ID,
      'files',
      expect.objectContaining({ navigationGeneration: expect.any(Number), onCommit: expect.any(Function) }),
    )
    expect(
      preferredWorkspacePaneTabForTarget(workspacesStore.getState().workspaces[REPO_ID]!.ui, {
        kind: 'workspace-root',
        workspaceId: REPO_ID,
      }),
    ).toBe('files')
  })

  test.each([
    ['rejected', false, false],
    ['superseded', true, false],
    ['committed', true, true],
  ] as const)(
    'keeps workspace terminal selection and preference atomic when presentation is %s',
    (_state, accepted, commit) => {
      const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      const terminalKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, REPO_ID)
      workspacesStore.getState().setSelectedTerminal(terminalKey, 'term-111111111111111111111')
      workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: REPO_ID }, 'files')
      const navigation = routeNavigation()
      vi.mocked(navigation.openWorkspaceRootTerminal).mockImplementation((_repoId, _sessionId, options) => {
        if (accepted && commit) options?.onCommit?.()
        return accepted
      })
      const actions = createAppNavigationActions({
        currentWorkspaceId: REPO_ID,
        workspaceOrder: [REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      expect(
        actions.showWorkspaceRootPaneTab(REPO_ID, {
          kind: 'terminal',
          terminalSessionId: 'term-222222222222222222222',
        }),
      ).toBe(accepted)
      expect(workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalKey]).toBe(
        commit ? 'term-222222222222222222222' : 'term-111111111111111111111',
      )
      expect(
        preferredWorkspacePaneTabForTarget(workspacesStore.getState().workspaces[repo.id]!.ui, {
          kind: 'workspace-root',
          workspaceId: repo.id,
        }),
      ).toBe(commit ? 'terminal' : 'files')
    },
  )

  test('falls back to Dashboard when the saved worktree target no longer exists', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [],
      currentBranchName: BRANCH_NAME,
    })
    workspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_ID,
      route: {
        kind: 'worktree',
        worktreePath: WORKTREE_PATH,
        workspacePaneTab: 'files',
        terminalSessionId: null,
      },
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: OTHER_WORKSPACE_ID,
      workspaceOrder: [OTHER_WORKSPACE_ID, REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(navigation.openRepoWorktreeTab).not.toHaveBeenCalled()
  })

  test('falls back to Dashboard when a saved worktree snapshot is unavailable', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
    })
    workspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_ID,
      route: {
        kind: 'worktree',
        worktreePath: WORKTREE_PATH,
        workspacePaneTab: 'files',
        terminalSessionId: null,
      },
    })
    const workspace = workspacesStore.getState().workspaces[REPO_ID]
    if (!workspace) throw new Error('missing test workspace')
    appQueryClient.removeQueries({ queryKey: repoSnapshotQueryKey(REPO_ID, workspace.workspaceRuntimeId) })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: OTHER_WORKSPACE_ID,
      workspaceOrder: [OTHER_WORKSPACE_ID, REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(navigation.openRepoWorktree).not.toHaveBeenCalled()
    expect(navigation.openRepoWorktreeTab).not.toHaveBeenCalled()
    expect(navigation.openRepoWorktreeTerminal).not.toHaveBeenCalled()
  })

  test('commits a filesystem route only while its workspace runtime remains current', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitFilesystemWorkspacePaneRoute = vi.fn(async () => await routeCommit.promise)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()
    const previousPreference = preferredWorkspacePaneTabForTarget(repo.ui, {
      kind: 'workspace-root',
      workspaceId: REPO_ID,
    })
    const commit = actions.commitFilesystemWorkspacePaneRoute(
      {
        routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
        workspaceRuntimeId: repo.workspaceRuntimeId,
      },
      { kind: 'static', tab: 'files' },
      { onAbandon },
    )
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: replaceWorkspace(repo, (draft) => {
          draft.workspaceRuntimeId = 'repo-runtime-replacement'
        }),
      },
    }))
    routeCommit.resolve(true)

    await expect(commit).resolves.toBe(false)
    expect(onAbandon).toHaveBeenCalledOnce()
    expect(
      preferredWorkspacePaneTabForTarget(workspacesStore.getState().workspaces[REPO_ID]!.ui, {
        kind: 'workspace-root',
        workspaceId: REPO_ID,
      }),
    ).toBe(previousPreference)
  })

  test('rejects an invalid filesystem commit lease before starting navigation', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    navigation.commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()
    const generation = currentAppNavigationGeneration()

    await expect(
      actions.commitFilesystemWorkspacePaneRoute(
        worktreeSelectionLease(),
        { kind: 'static', tab: 'files' },
        { onAbandon },
      ),
    ).resolves.toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(onAbandon).toHaveBeenCalledOnce()
    expect(navigation.commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('abandons a committed worktree route when the authoritative worktree disappears', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH)],
      status: [{ path: WORKTREE_PATH, branch: 'feature/worktree', isMain: false, entries: [] }],
      currentBranchName: 'feature/worktree',
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitFilesystemWorkspacePaneRoute = vi.fn(async () => await routeCommit.promise)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()
    const commit = actions.commitFilesystemWorkspacePaneRoute(
      {
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
        workspaceRuntimeId: repo.workspaceRuntimeId,
      },
      { kind: 'static', tab: 'files' },
      { onAbandon },
    )
    const snapshot = getRepoSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId)
    if (!snapshot) throw new Error('expected seeded snapshot')
    setRepoSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId, { ...snapshot, worktrees: [] })
    routeCommit.resolve(true)

    await expect(commit).resolves.toBe(false)
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('abandons exactly once when filesystem presentation projection commit throws', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const navigation = routeNavigation()
    navigation.commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()
    vi.spyOn(workspacesStore.getState(), 'setWorkspacePaneTabForTarget').mockImplementationOnce(() => {
      throw new Error('projection commit failed')
    })

    await expect(
      actions.commitFilesystemWorkspacePaneRoute(
        {
          routeTarget: { kind: 'workspace-root', workspaceId: REPO_ID },
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        { kind: 'static', tab: 'files' },
        { onAbandon },
      ),
    ).rejects.toThrow('projection commit failed')
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('activates a non-Git workspace at its Dashboard without restoring Git navigation history', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    markRepoGitUnavailable(REPO_ID)
    workspacesStore.setState((state) => ({
      navigationHistoryByWorkspace: {
        ...state.navigationHistoryByWorkspace,
        [REPO_ID]: {
          backStack: [],
          current: { workspaceId: REPO_ID, route: { kind: 'dashboard' } },
          forwardStack: [],
        },
      },
    }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: null,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(navigation.openWorkspaceNavigator).not.toHaveBeenCalled()
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test.each(['workspace-root', 'dashboard'] as const)(
    'activates a non-Git workspace at its last %s presentation',
    (kind) => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      markRepoGitUnavailable(REPO_ID)
      workspacesStore.getState().recordWorkspaceNavigation({
        workspaceId: REPO_ID,
        route: kind === 'workspace-root' ? { kind, workspacePaneTab: null, terminalSessionId: null } : { kind },
      })
      const navigation = routeNavigation()
      const actions = createAppNavigationActions({
        currentWorkspaceId: OTHER_WORKSPACE_ID,
        workspaceOrder: [OTHER_WORKSPACE_ID, REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      actions.activateWorkspace(REPO_ID)

      if (kind === 'workspace-root') {
        expect(navigation.openWorkspaceRootPane).toHaveBeenCalledWith(REPO_ID, presentationOptions())
        expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
      } else {
        expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
        expect(navigation.openWorkspaceRootPane).not.toHaveBeenCalled()
      }
    },
  )

  test.each([['files', null] as const, ['terminal', 'term-111111111111111111111'] as const])(
    'restores the workspace-root %s presentation when switching workspaces',
    (tab, terminalSessionId) => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      markRepoGitUnavailable(REPO_ID)
      workspacesStore.getState().recordWorkspaceNavigation({
        workspaceId: REPO_ID,
        route: { kind: 'workspace-root', workspacePaneTab: tab, terminalSessionId },
      })
      const navigation = routeNavigation()
      const actions = createAppNavigationActions({
        currentWorkspaceId: OTHER_WORKSPACE_ID,
        workspaceOrder: [OTHER_WORKSPACE_ID, REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      actions.activateWorkspace(REPO_ID)

      if (tab === 'terminal') {
        expect(navigation.openWorkspaceRootTerminal).toHaveBeenCalledWith(
          REPO_ID,
          terminalSessionId,
          presentationOptions(),
        )
        expect(navigation.openWorkspaceRootTab).not.toHaveBeenCalled()
      } else {
        expect(navigation.openWorkspaceRootTab).toHaveBeenCalledWith(REPO_ID, tab, presentationOptions())
        expect(navigation.openWorkspaceRootTerminal).not.toHaveBeenCalled()
      }
      expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    },
  )

  test.each([
    {
      kind: 'branch',
      branchName: 'feature/stale',
      workspacePaneTab: null,
    },
    {
      kind: 'worktree',
      worktreePath: '/tmp/stale-worktree',
      workspacePaneTab: 'files' as const,
      terminalSessionId: null,
    },
    { kind: 'newWorktree', returnTo: null },
  ] satisfies WorkspaceNavigationHistoryEntry['route'][])(
    'falls back to Dashboard instead of restoring stale non-Git $kind history',
    (route) => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      markRepoGitUnavailable(REPO_ID)
      workspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_ID, route })
      const navigation = routeNavigation()
      const openRepoWorktreeTab = vi.fn(() => true)
      navigation.openRepoWorktreeTab = openRepoWorktreeTab
      const actions = createAppNavigationActions({
        currentWorkspaceId: OTHER_WORKSPACE_ID,
        workspaceOrder: [OTHER_WORKSPACE_ID, REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      actions.activateWorkspace(REPO_ID)

      expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
      expect(navigation.openRepoBranch).not.toHaveBeenCalled()
      expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
      expect(navigation.openRepoWorktree).not.toHaveBeenCalled()
      expect(openRepoWorktreeTab).not.toHaveBeenCalled()
      expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
    },
  )

  test('selects branches by resolving the branch workspace pane route', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease(), { replace: true })

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'status',
      presentationOptions({ replace: true }),
    )
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('selects an admitted worktree without rebuilding its target from coordinates', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    expect(actions.selectRepoWorktree(worktreeSelectionLease(), { replace: true })).toBe(true)
    expect(navigation.openRepoWorktree).toHaveBeenCalledWith(
      REPO_ID,
      WORKTREE_PATH,
      presentationOptions({ replace: true }),
    )
  })

  test('rejects a worktree selection owned by a replaced workspace runtime before starting navigation', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
    })
    const target = worktreeSelectionLease()
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: replaceWorkspace(repo, (draft) => {
          draft.workspaceRuntimeId = 'replacement-runtime'
        }),
      },
    }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const generation = currentAppNavigationGeneration()

    expect(actions.selectRepoWorktree(target)).toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(navigation.openRepoWorktree).not.toHaveBeenCalled()
  })

  test('rejects a worktree selection missing from the current snapshot before starting navigation', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const generation = currentAppNavigationGeneration()

    expect(actions.selectRepoWorktree(worktreeSelectionLease())).toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(navigation.openRepoWorktree).not.toHaveBeenCalled()
  })

  test('rejects a stale branch selection before starting navigation', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      currentBranchName: BRANCH_NAME,
    })
    const staleTarget = branchSelectionLease()
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: replaceWorkspace(repo, (draft) => {
          draft.workspaceRuntimeId = 'replacement-runtime'
        }),
      },
    }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const generation = currentAppNavigationGeneration()

    expect(actions.selectRepoBranch(staleTarget)).toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoWorktreeTerminal).not.toHaveBeenCalled()
  })

  test('rejects a missing branch selection before starting navigation', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const generation = currentAppNavigationGeneration()

    expect(actions.selectRepoBranch(branchSelectionLease('feature/missing'))).toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoWorktreeTerminal).not.toHaveBeenCalled()
  })

  test('selects a materialized branch through its active worktree terminal route', () => {
    const terminalSessionId = 'term-111111111111111111111'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
      },
    })
    workspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
    const terminalFilesystemTargetSnapshot = installTerminalSessionCommandBridgeForTest(
      worktreeSnapshotForSessions([terminalSessionId]),
    )
    const navigation = routeNavigation()
    navigation.openRepoWorktreeTerminal = vi.fn((_repoId, _worktreePath, _terminalSessionId, options) => {
      options?.onCommit?.()
      return true
    })
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease(), { replace: true })

    expect(navigation.openRepoWorktreeTerminal).toHaveBeenCalledWith(
      REPO_ID,
      WORKTREE_PATH,
      terminalSessionId,
      presentationOptions({ replace: true }),
    )
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(terminalFilesystemTargetSnapshot).toHaveBeenCalledWith(WORKTREE_KEY)
  })

  test('opens the branch root while workspace pane tabs are still loading', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease(), { replace: true })

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions({ replace: true }))
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
  })

  test('opens the branch root when workspace pane tab restoration failed', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    appQueryClient.removeQueries({ queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    await appQueryClient
      .fetchQuery({
        queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('tabs unavailable')
        },
        retry: false,
      })
      .catch(() => undefined)
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease())

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
  })

  test('selects branches by falling back when the preferred workspace pane tab is stale', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease())

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status', presentationOptions())
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('selects branches with an intentional empty workspace pane route', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: null,
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(branchSelectionLease())

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
  })

  test('does not commit route supplements when operation-owned navigation settles', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    const committed = actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, {
      kind: 'static',
      tab: 'history',
    })
    expect(preferredWorkspacePaneTab()).toBe('status')

    routeCommit.resolve(true)
    await expect(committed).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('forwards operation abandonment to the route owner', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(async (_workspaceId, _branchName, _route, options) => {
      options?.onAbandon?.()
      return false
    })
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()

    await expect(actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, null, { onAbandon })).resolves.toBe(false)
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('blocks workspace history restore before mutating history while terminal creation is pending', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME)],
      worktrees: [createRepoWorktreeSnapshotForTest(BRANCH_NAME, WORKTREE_PATH)],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const dashboard = {
      workspaceId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    const worktree = {
      workspaceId: REPO_ID,
      route: {
        kind: 'worktree',
        worktreePath: WORKTREE_PATH,
        workspacePaneTab: 'status',
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    workspacesStore.getState().recordWorkspaceNavigation(dashboard)
    workspacesStore.getState().recordWorkspaceNavigation(worktree)
    installTerminalSessionCommandBridgeForTest(createPendingWorktreeSnapshot())
    const peekWorkspaceNavigation = vi.fn((workspaceId: WorkspaceId, direction: 'back' | 'forward') =>
      workspacesStore.getState().peekWorkspaceNavigation(workspaceId, direction),
    )
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: workspacesStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(worktree)
  })
})
