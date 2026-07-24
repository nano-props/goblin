import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPrimaryWindowNavigationActions as createPrimaryWindowNavigationActionsCore } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { createRepoBranch, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalFilesystemTargetSnapshot } from '#/web/components/terminal/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryTraversal,
} from '#/web/stores/workspaces/types.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { emptyWorkspace, replaceWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { currentPrimaryWindowNavigationGeneration } from '#/web/primary-window-navigation-lifecycle.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/navigation-actions-repo')
const REPO_A_ID = workspaceIdForTest('goblin+file:///tmp/repo-a')
const REPO_B_ID = workspaceIdForTest('goblin+file:///tmp/repo-b')
const REPO_C_ID = workspaceIdForTest('goblin+file:///tmp/repo-c')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/other-workspace')
const BRANCH_NAME = 'feature/create-pending'
const presentationOptions = (options: { replace?: boolean; returnTo?: string | null } = {}) =>
  expect.objectContaining({ ...options, navigationGeneration: expect.any(Number) })
const WORKTREE_PATH = '/tmp/navigation-actions-worktree'
const WORKTREE_KEY = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetWorkspacesStore()
  setTerminalSessionCommandBridge(null)
})

describe('createPrimaryWindowNavigationActions', () => {
  test('presents a workspace-root tab through the workspace route and commits its preference', () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      preferredWorkspacePaneTabForTarget(useWorkspacesStore.getState().workspaces[REPO_ID]!.ui, {
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
      useWorkspacesStore.getState().setSelectedTerminal(terminalKey, 'term-111111111111111111111')
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: REPO_ID }, 'files')
      const navigation = routeNavigation()
      vi.mocked(navigation.openWorkspaceRootTerminal).mockImplementation((_repoId, _sessionId, options) => {
        if (accepted && commit) options?.onCommit?.()
        return accepted
      })
      const actions = createPrimaryWindowNavigationActions({
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
      expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalKey]).toBe(
        commit ? 'term-222222222222222222222' : 'term-111111111111111111111',
      )
      expect(
        preferredWorkspacePaneTabForTarget(useWorkspacesStore.getState().workspaces[repo.id]!.ui, {
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
    const actions = createPrimaryWindowNavigationActions({
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
    useWorkspacesStore.setState((state) => ({
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
      preferredWorkspacePaneTabForTarget(useWorkspacesStore.getState().workspaces[REPO_ID]!.ui, {
        kind: 'workspace-root',
        workspaceId: REPO_ID,
      }),
    ).toBe(previousPreference)
  })

  test('abandons a committed worktree route when the authoritative worktree disappears', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      status: [{ path: WORKTREE_PATH, branch: 'feature/worktree', isMain: false, entries: [] }],
      currentBranchName: 'feature/worktree',
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitFilesystemWorkspacePaneRoute = vi.fn(async () => await routeCommit.promise)
    const actions = createPrimaryWindowNavigationActions({
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
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()
    vi.spyOn(useWorkspacesStore.getState(), 'setWorkspacePaneTabForTarget').mockImplementationOnce(() => {
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

  test('activates a non-Git workspace at its Dashboard without restoring Git navigation history', () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    markRepoGitUnavailable(REPO_ID)
    useWorkspacesStore.setState((state) => ({
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
    const actions = createPrimaryWindowNavigationActions({
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
      useWorkspacesStore.getState().recordWorkspaceNavigation({
        workspaceId: REPO_ID,
        route: kind === 'workspace-root' ? { kind, workspacePaneTab: null, terminalSessionId: null } : { kind },
      })
      const navigation = routeNavigation()
      const actions = createPrimaryWindowNavigationActions({
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
      useWorkspacesStore.getState().recordWorkspaceNavigation({
        workspaceId: REPO_ID,
        route: { kind: 'workspace-root', workspacePaneTab: tab, terminalSessionId },
      })
      const navigation = routeNavigation()
      const actions = createPrimaryWindowNavigationActions({
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
      useWorkspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_ID, route })
      const navigation = routeNavigation()
      const openRepoWorktreeTab = vi.fn(() => true)
      navigation.openRepoWorktreeTab = openRepoWorktreeTab
      const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    await primaryWindowQueryClient
      .fetchQuery({
        queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('tabs unavailable')
        },
        retry: false,
      })
      .catch(() => undefined)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: null,
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
    const actions = createPrimaryWindowNavigationActions({
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
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
    })
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(async (_workspaceId, _branchName, _route, options) => {
      options?.onAbandon?.()
      return false
    })
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })
    const onAbandon = vi.fn()

    await expect(actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, null, { onAbandon })).resolves.toBe(false)
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('blocks workspace history restore before mutating history while terminal creation is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
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
    useWorkspacesStore.getState().recordWorkspaceNavigation(dashboard)
    useWorkspacesStore.getState().recordWorkspaceNavigation(branch)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const peekWorkspaceNavigation = vi.fn((workspaceId: WorkspaceId, direction: 'back' | 'forward') =>
      useWorkspacesStore.getState().peekWorkspaceNavigation(workspaceId, direction),
    )
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: useWorkspacesStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(branch)
  })

  test('cycles repos by navigating from the current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
  })

  test('activates a repo at its current workspace history entry', () => {
    seedRepoWithReadModelForTest({
      id: REPO_B_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'history')
    useWorkspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_B_ID,
      'feature/remembered',
      'history',
      presentationOptions(),
    )
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('does not resume a repo at its new-worktree workflow', () => {
    useWorkspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_B_ID,
      route: { kind: 'newWorktree', returnTo: '/workspace/repo-b/branch/main' },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })

  test('does not replace a blocked repo history restore with the dashboard', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    useWorkspacesStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(entry)
  })

  test('falls back to the dashboard when a repo history route is unavailable', () => {
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'history')
    useWorkspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
  })

  test('falls back to the dashboard when workspace-root history cannot be presented', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-b')
    const currentWorkspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-a')
    useWorkspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: workspaceId,
      route: { kind: 'workspace-root', workspacePaneTab: null, terminalSessionId: null },
    })
    const navigation = routeNavigation()
    vi.mocked(navigation.openWorkspaceRootPane).mockReturnValue(false)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId,
      workspaceOrder: [currentWorkspaceId, workspaceId],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(workspaceId)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(workspaceId, presentationOptions())
  })

  test('cycles to the target repo current workspace history entry', () => {
    seedRepoWithReadModelForTest({
      id: REPO_B_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'status')
    useWorkspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_B_ID,
      'feature/remembered',
      'status',
      presentationOptions(),
    )
  })

  test('cycles repos backward and wraps around', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(-1)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_C_ID, presentationOptions())
  })

  test('closes the repo through the store action without navigation when it is not current', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('closes the current repo and navigates to the next repo dashboard without history', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_B_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_C_ID, presentationOptions())
  })

  test('closes the current repo and restores the next repo workspace history entry', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_C_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    useWorkspacesStore
      .getState()
      .recordWorkspaceNavigation(branchHistoryEntry(REPO_C_ID, 'feature/remembered', 'history'))
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_B_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_C_ID,
      'feature/remembered',
      'history',
      presentationOptions(),
    )
  })

  test('closes the current repo into the next repo dashboard when its history restore is blocked', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    useWorkspacesStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_A_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_A_ID)
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(entry)
  })

  test('closes the final current repo and navigates home', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(async () => ({ ok: true as const })),
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_A_ID)

    expect(navigation.openHome).toHaveBeenCalled()
  })

  test('keeps the current route when the shared workspace close fails', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(async () => ({ ok: false as const, message: 'error.failed-read-repo' })),
      routeNavigation: navigation,
    })

    await expect(actions.closeWorkspace(REPO_A_ID)).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(navigation.openHome).not.toHaveBeenCalled()
  })

  test('opens create worktree for the current repo', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith(REPO_A_ID, presentationOptions())
  })

  test('restores a saved new-worktree return target when navigating workspace history', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: { kind: 'newWorktree' as const, returnTo: '/workspace/repo-a/branch/main' },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_A_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith(
      REPO_A_ID,
      presentationOptions({ returnTo: '/workspace/repo-a/branch/main' }),
    )
  })

  test('restores a saved bare branch workspace history entry', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_A_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_A_ID, 'feature/test', presentationOptions())
  })

  test.each(['back', 'forward'] as const)('moves %s history only after the restored route commits', (direction) => {
    const navigation = routeNavigation()
    let commitRoute: (() => void) | undefined
    vi.mocked(navigation.openRepoBranch).mockImplementation((_workspaceId, _branchName, options) => {
      commitRoute = options?.onCommit
      return true
    })
    const target: WorkspaceNavigationHistoryEntry = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch',
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    }
    const traversal = { ...historyTraversal(target), direction }
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation: vi.fn(() => traversal),
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    if (direction === 'back') actions.goBack(REPO_A_ID)
    else actions.goForward(REPO_A_ID)

    expect(commitWorkspaceNavigation).not.toHaveBeenCalled()
    expect(commitRoute).toBeTypeOf('function')

    commitRoute?.()

    expect(commitWorkspaceNavigation).toHaveBeenCalledOnce()
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
  })

  test.each(['back', 'forward'] as const)(
    'keeps navigation generation unchanged when %s has no target',
    (direction) => {
      seedRepoWithReadModelForTest({ id: REPO_A_ID, branches: [], currentBranchName: null })
      const navigation = routeNavigation()
      const peekWorkspaceNavigation = vi.fn(() => null)
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: REPO_A_ID,
        workspaceOrder: [REPO_A_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation: vi.fn(),
        routeNavigation: navigation,
      })
      const generationBefore = currentPrimaryWindowNavigationGeneration()

      if (direction === 'back') actions.goBack(REPO_A_ID)
      else actions.goForward(REPO_A_ID)

      expect(currentPrimaryWindowNavigationGeneration()).toBe(generationBefore)
      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, direction)
    },
  )

  test.each(['back', 'forward'] as const)(
    'restores a saved bare worktree history entry when navigating %s',
    (direction) => {
      const navigation = routeNavigation()
      const target: WorkspaceNavigationHistoryEntry = {
        workspaceId: REPO_ID,
        route: {
          kind: 'worktree',
          worktreePath: WORKTREE_PATH,
          workspacePaneTab: null,
          terminalSessionId: null,
        },
      }
      const traversal: WorkspaceNavigationHistoryTraversal = {
        workspaceId: REPO_ID,
        direction,
        current: { workspaceId: REPO_ID, route: { kind: 'dashboard' } },
        target,
      }
      const peekWorkspaceNavigation = vi.fn(() => traversal)
      const commitWorkspaceNavigation = vi.fn(() => true)
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: REPO_ID,
        workspaceOrder: [REPO_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation: navigation,
      })

      if (direction === 'back') actions.goBack(REPO_ID)
      else actions.goForward(REPO_ID)

      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, direction)
      expect(navigation.openRepoWorktree).toHaveBeenCalledWith(REPO_ID, WORKTREE_PATH, presentationOptions())
      expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    },
  )

  test('does not block bare branch history restore while tabs projection is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const branch = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    const dashboard = {
      workspaceId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    useWorkspacesStore.getState().recordWorkspaceNavigation(branch)
    useWorkspacesStore.getState().recordWorkspaceNavigation(dashboard)
    const navigation = routeNavigation()
    const peekWorkspaceNavigation = vi.fn((workspaceId: WorkspaceId, direction: 'back' | 'forward') =>
      useWorkspacesStore.getState().peekWorkspaceNavigation(workspaceId, direction),
    )
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: useWorkspacesStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, 'back')
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
  })

  test('restores a malformed terminal history entry as the bare branch route', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: 'terminal' as const,
        terminalFilesystemTargetKey: 'goblin+file:///tmp/repo-a\0goblin+file:///tmp/worktree',
        terminalSessionId: null,
      },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_A_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_A_ID, 'feature/test', presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test.each(['back', 'forward'] as const)(
    'does not commit %s history when route restore is unavailable',
    (direction) => {
      const target = branchHistoryEntry(REPO_A_ID, 'feature/test', 'history')
      const traversal = { ...historyTraversal(target), direction }
      const peekWorkspaceNavigation = vi.fn(() => traversal)
      const commitWorkspaceNavigation = vi.fn(() => true)
      const navigation = routeNavigation()
      vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: REPO_A_ID,
        workspaceOrder: [REPO_A_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation: navigation,
      })

      if (direction === 'back') actions.goBack(REPO_A_ID)
      else actions.goForward(REPO_A_ID)

      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, direction)
      expect(commitWorkspaceNavigation).not.toHaveBeenCalled()
    },
  )

  test('does not open create worktree without a current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: null,
      workspaceOrder: [],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })
})

function preferredWorkspacePaneTab() {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { workspaceId: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          BRANCH_NAME,
        ),
      )
    : null
}

function branchHistoryEntry(
  workspaceId: WorkspaceId,
  branchName: string,
  workspacePaneTab: 'status' | 'history',
): WorkspaceNavigationHistoryEntry {
  return {
    workspaceId,
    route: {
      kind: 'branch',
      branchName,
      workspacePaneTab,
      terminalFilesystemTargetKey: null,
      terminalSessionId: null,
    },
  }
}

function historyTraversal(target: WorkspaceNavigationHistoryEntry): WorkspaceNavigationHistoryTraversal {
  return {
    workspaceId: target.workspaceId,
    direction: 'back',
    current: { workspaceId: target.workspaceId, route: { kind: 'dashboard' } },
    target,
  }
}

type PrimaryWindowNavigationActionOptions = Parameters<typeof createPrimaryWindowNavigationActionsCore>[0]
type PrimaryWindowNavigationActionTestOptions = Omit<
  PrimaryWindowNavigationActionOptions,
  'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'
> &
  Partial<Pick<PrimaryWindowNavigationActionOptions, 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>>

function createPrimaryWindowNavigationActions(options: PrimaryWindowNavigationActionTestOptions) {
  if (options.currentWorkspaceId && !useWorkspacesStore.getState().workspaces[options.currentWorkspaceId]) {
    const workspace = emptyWorkspace(options.currentWorkspaceId, 'workspace', 'navigation-actions-runtime')
    useWorkspacesStore.setState((state) => ({
      workspaces: { ...state.workspaces, [workspace.id]: workspace },
    }))
  }
  const store = useWorkspacesStore.getState()
  return createPrimaryWindowNavigationActionsCore({
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    ...options,
  })
}

function markRepoGitUnavailable(workspaceId: string): void {
  useWorkspacesStore.setState((state) => {
    const repo = state.workspaces[workspaceId]
    if (!repo) return state
    return {
      workspaces: {
        ...state.workspaces,
        [workspaceId]: replaceWorkspace(repo, (draft) => {
          acceptWorkspaceProbeState(draft, {
            status: 'ready',
            name: 'workspace',
            capabilities: {
              files: { read: true, write: true },
              terminal: { available: true },
              git: { status: 'unavailable' },
            },
            diagnostics: [],
          })
        }),
      },
    }
  })
}

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    workspaceSlugForId: vi.fn(() => 'repo-slug'),
    currentWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openWorkspaceNavigator: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn((_repoId, options) => {
      options?.onCommit?.()
      return true
    }),
    openWorkspaceRootTab: vi.fn((_workspaceId, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
    openWorkspaceRootTerminal: vi.fn((_workspaceId, _terminalSessionId, options) => {
      options?.onCommit?.()
      return true
    }),
    commitFilesystemWorkspacePaneRoute: vi.fn(async () => {
      throw new Error('Unexpected workspace-root route commit in test')
    }),
    openRepoBranch: vi.fn((_repoId, _branchName, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTab: vi.fn((_repoId, _branchName, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTerminal: vi.fn((_repoId, _branchName, _sessionId, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoWorktree: vi.fn((_repoId, _worktreePath, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoWorktreeTerminal: vi.fn(() => {
      throw new Error('Unexpected worktree terminal navigation in test')
    }),
    openRepoWorktreeTab: vi.fn(() => {
      throw new Error('Unexpected worktree tab navigation in test')
    }),
    commitWorkspacePaneRoute: vi.fn(async () => {
      throw new Error('Unexpected workspace pane route commit in test')
    }),
    openRepoNewWorktree: vi.fn((_workspaceId, options) => {
      options?.onCommit?.()
    }),
    cancelRepoNewWorktree: vi.fn(),
  }
}

function createPendingWorktreeSnapshot(): TerminalFilesystemTargetSnapshot {
  return {
    terminalFilesystemTargetKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: true,
  }
}
