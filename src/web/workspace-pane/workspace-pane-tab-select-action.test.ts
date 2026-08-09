import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { resetAppNavigationForTest } from '#/web/app-navigation-lifecycle.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { installWorkspacePaneTabsTestBridge } from '#/web/test-utils/workspace-pane-bridge.ts'
import {
  observeWorkspacePaneRouteForTest,
  observedAppNavigationActionsForTest,
  observedWorkspacePaneRouteForTarget,
  seedInitialObservedWorkspacePaneRouteForTest,
  type ObservedAppNavigationActionsForTest,
  type AppNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
  workspacePaneActionTargetFromCoordinates,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { dispatchOpenWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  dispatchMoveWorkspacePaneTabAction,
  dispatchSelectWorkspacePaneTabByIdentityAction,
} from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-select-repo')
const WORKTREE_PATH = '/tmp/workspace-pane-tab-select-worktree'
const PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
  head: { kind: 'branch' as const, branchName: 'feature/worktree' },
}

beforeEach(() => {
  resetWorkspacePaneActionQueueForTest()
  resetAppNavigationForTest()
  appQueryClient.clear()
  resetWorkspacesStore()
  installWorkspacePaneTabsTestBridge()
})

afterEach(() => {
  setClientBridgeForTests(null)
})

describe('workspace pane tab select action', () => {
  test('rebases the latest queued absolute selection after an earlier route commit', async () => {
    const target = seedTarget(['status', 'files', 'history'])
    observeStatusRoute(target)
    const showTab = storeBackedShowTab()
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })

    const selectFiles = selectTab('workspace-pane:files', navigation)
    const selectHistory = selectTab('workspace-pane:history', navigation)

    await expect(selectFiles).resolves.toBe(false)
    await expect(selectHistory).resolves.toBe(true)
    expect(showTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
    expect(showTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
  })

  test('resolves each queued relative move from the route current at execution time', async () => {
    const target = seedTarget(['status', 'files', 'history'])
    observeStatusRoute(target)
    const showTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates(target),
      () => blocker.promise,
    )

    const firstMove = moveTab(navigation)
    const secondMove = moveTab(navigation)
    expect(showTab).not.toHaveBeenCalled()

    blocker.resolve()
    await blockingAction
    await expect(firstMove).resolves.toBe(true)
    await expect(secondMove).resolves.toBe(true)
    expect(showTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
    expect(showTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
  })

  test.each([
    ['relative move', (navigation: ObservedAppNavigationActionsForTest) => moveTab(navigation)],
    [
      'absolute selection',
      (navigation: ObservedAppNavigationActionsForTest) => selectTab('workspace-pane:files', navigation),
    ],
  ] as const)('rejects a queued %s after its workspace runtime epoch is replaced', async (_action, dispatch) => {
    const target = seedTarget(['status', 'files'])
    observeStatusRoute(target)
    const showTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates(target),
      () => blocker.promise,
    )
    const queuedAction = dispatch(navigation)

    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: 'repo-runtime-replaced' },
      },
    }))
    blocker.resolve()
    await blockingAction

    await expect(queuedAction).resolves.toBe(false)
    expect(showTab).not.toHaveBeenCalled()
  })

  test('rejects a queued relative move after the router leaves its workspace target', async () => {
    const target = seedTarget(['status', 'files'])
    let currentRoute: WorkspacePaneRouteTarget | undefined = { kind: 'static', tab: 'status' }
    const showTab = vi.fn(() => true)
    const navigation = navigationWith({
      currentWorkspacePaneRoute: () => currentRoute,
      showRepoBranchWorkspacePaneTab: showTab,
    })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates(target),
      () => blocker.promise,
    )
    const move = moveTab(navigation)

    currentRoute = undefined
    blocker.resolve()
    await blockingAction

    await expect(move).resolves.toBe(false)
    expect(showTab).not.toHaveBeenCalled()
  })

  test('serializes open then move through exact route commits', async () => {
    const target = seedTarget(['status', 'history'])
    observeStatusRoute(target)
    const showTab = storeBackedShowTab()
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })

    const openFiles = dispatchOpenWorkspacePaneStaticTabAction({
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'files',
      workspacePaneRoute: { kind: 'static', tab: 'status' },
      navigation,
    })
    const move = moveTab(navigation)

    await expect(openFiles).resolves.toBe(true)
    await expect(move).resolves.toBe(true)
    expect(showTab).toHaveBeenNthCalledWith(1, REPO_ID, 'feature/worktree', 'files')
    expect(showTab).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/worktree', 'history')
  })
})

function seedTarget(tabTypes: WorkspacePaneStaticTabType[]) {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [
      createBranchSnapshot('feature/worktree', {
        worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
      }),
    ],
    currentBranchName: 'feature/worktree',
    workspacePaneTabsByBranch: {
      'feature/worktree': tabTypes.map(workspacePaneStaticTabEntry),
    },
  })
  return {
    workspaceId: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
}

function observeStatusRoute(target: ReturnType<typeof seedTarget>): void {
  observeWorkspacePaneRouteForTest({ ...target, route: { kind: 'static', tab: 'status' } })
}

function selectTab(identity: string, navigation: ObservedAppNavigationActionsForTest) {
  return dispatchSelectWorkspacePaneTabByIdentityAction({
    routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/worktree' },
    paneTarget: PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    identity,
    navigation,
  })
}

function moveTab(navigation: ObservedAppNavigationActionsForTest) {
  return dispatchMoveWorkspacePaneTabAction({
    routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/worktree' },
    paneTarget: PANE_TARGET,
    worktreeHead: { kind: 'branch', branchName: 'feature/worktree' },
    workspaceId: REPO_ID,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })
}

function storeBackedShowTab() {
  return vi.fn((workspaceId: WorkspaceId, branchName: string, tab: WorkspacePaneStaticTabType) => {
    workspacesStore.getState().setWorkspacePaneTab(workspaceId, branchName, tab)
    return true
  })
}

function navigationWith(
  overrides: AppNavigationOverridesForTest = {},
  options: { autoSeedInitialRoute?: boolean } = {},
): ObservedAppNavigationActionsForTest {
  seedInitialObservedWorkspacePaneRouteForTest(undefined, { autoSeed: options.autoSeedInitialRoute !== false })
  return observedAppNavigationActionsForTest({
    currentWorkspacePaneRoute: observedWorkspacePaneRouteForTarget,
    activateWorkspace: (workspaceId) =>
      workspacesStore.setState({ restoredWorkspaceId: workspaceIdForTest(workspaceId) }),
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: (workspaceId, branch, tab) => {
      const state = workspacesStore.getState()
      const canonicalWorkspaceId = workspaceIdForTest(workspaceId)
      workspacesStore.setState({ restoredWorkspaceId: canonicalWorkspaceId })
      state.setWorkspacePaneTab(canonicalWorkspaceId, branch, tab)
      return true
    },
    showRepoBranchTerminalSession: () => true,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}
