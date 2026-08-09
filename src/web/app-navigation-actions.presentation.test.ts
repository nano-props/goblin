import { seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/workspaces/types.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  REPO_ID,
  OTHER_WORKSPACE_ID,
  BRANCH_NAME,
  presentationOptions,
  WORKTREE_PATH,
  WORKTREE_KEY,
  setupAppNavigationActionsTests,
  preferredWorkspacePaneTab,
  createAppNavigationActions,
  markRepoGitUnavailable,
  routeNavigation,
  createPendingWorktreeSnapshot,
} from '#/web/app-navigation-actions.test-utils.ts'

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
        authority: { kind: 'workspace-runtime' },
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

  test('abandons a committed worktree route when the authoritative worktree disappears', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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
        authority: { kind: 'branch', branchName: 'feature/worktree' },
      },
      { kind: 'static', tab: 'files' },
      { onAbandon },
    )
    setRepoWorktreeStatusQueryData(REPO_ID, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      loadedAt: 2,
      status: [],
    })
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
          authority: { kind: 'workspace-runtime' },
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
      terminalFilesystemTargetKey: null,
      terminalSessionId: null,
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
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME, { replace: true })

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'status',
      presentationOptions({ replace: true }),
    )
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('opens the branch root while workspace pane tabs are still loading', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME, { replace: true })

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions({ replace: true }))
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('opens the branch root when workspace pane tab restoration failed', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('selects branches by falling back when the preferred workspace pane tab is stale', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status', presentationOptions())
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('selects branches with an intentional empty workspace pane route', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('keeps command-owned route commits free of workspace pane supplements', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(async (workspaceId, branchName, route, options) => {
      if (route?.kind !== 'terminal') return false
      return navigation.openRepoBranchTerminal(workspaceId, branchName, route.terminalSessionId, options)
    })
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    const accepted = await actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, {
      kind: 'terminal',
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(accepted).toBe(true)
    expect(navigation.openRepoBranchTerminal).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'term-111111111111111111111',
      presentationOptions(),
    )
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('does not commit route supplements when operation-owned navigation settles', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
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
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const dashboard = {
      workspaceId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    const branch = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: 'status',
        terminalFilesystemTargetKey: WORKTREE_KEY,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    workspacesStore.getState().recordWorkspaceNavigation(dashboard)
    workspacesStore.getState().recordWorkspaceNavigation(branch)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
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
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(branch)
  })
})
