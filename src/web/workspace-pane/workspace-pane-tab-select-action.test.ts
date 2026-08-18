import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneRouteTarget } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacePaneLocationForLinkedWorktree } from '#/web/workspace-pane/workspace-pane-location.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { currentAppNavigationGeneration, resetAppNavigationForTest } from '#/web/app/navigation/lifecycle.ts'
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
import { setClientBridgeForTests } from '#/web/bridge/client.ts'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { dispatchOpenWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  dispatchMoveWorkspacePaneTabAction,
  dispatchSelectWorkspacePaneTabByIndexAction,
  dispatchSelectWorkspacePaneTabByIdentityAction,
} from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  failWorkspacePaneTabsQueryForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-select-repo')
const WORKTREE_PATH = '/tmp/workspace-pane-tab-select-worktree'
const PANE_TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: REPO_ID,
  worktreePath: WORKTREE_PATH,
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
  test('keeps stale canonical tabs available for local navigation after projection failure', async () => {
    const target = seedTarget(['status', 'files'])
    const navigation = navigationWith()
    await failWorkspacePaneTabsQueryForTest(REPO_ID, target.workspaceRuntimeId)

    await expect(selectTab('workspace-pane:files', navigation)).resolves.toBe(true)

    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'static', tab: 'files' },
      expect.anything(),
    )
  })

  test('does not select fabricated defaults when the first canonical tabs read fails', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH)],
      currentBranchName: 'feature/worktree',
    })
    const navigation = navigationWith()
    await failWorkspacePaneTabsQueryForTest(REPO_ID, repo.workspaceRuntimeId)

    await expect(selectTab('workspace-pane:status', navigation)).resolves.toBe(false)

    expect(navigation.commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('keeps protocol defaults available for local navigation after projection failure', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH)],
      currentBranchName: 'feature/worktree',
    })
    setWorkspacePaneTabsForTargetQueryData({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/other',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const navigation = navigationWith()
    await failWorkspacePaneTabsQueryForTest(REPO_ID, repo.workspaceRuntimeId)

    await expect(selectTab('workspace-pane:status', navigation)).resolves.toBe(true)

    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'static', tab: 'status' },
      expect.anything(),
    )
  })

  test('rejects a missing tab before starting navigation', async () => {
    seedTarget(['status'])
    const generation = currentAppNavigationGeneration()

    await expect(selectTab('workspace-pane:missing', navigationWith())).resolves.toBe(false)

    expect(currentAppNavigationGeneration()).toBe(generation)
  })

  test('rejects an out-of-range tab index before starting navigation', async () => {
    seedTarget(['status'])
    const generation = currentAppNavigationGeneration()

    await expect(
      dispatchSelectWorkspacePaneTabByIndexAction({
        location: workspacePaneLocationForLinkedWorktree(PANE_TARGET, currentRuntimeId(), {
          kind: 'branch',
          branchName: 'feature/worktree',
        }),
        workspaceId: REPO_ID,
        workspaceRuntimeId: currentRuntimeId(),
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        tabIndex: 2,
        navigation: navigationWith(),
      }),
    ).resolves.toBe(false)

    expect(currentAppNavigationGeneration()).toBe(generation)
  })

  test('rejects a stale target before starting navigation', async () => {
    const target = seedTarget(['status', 'files'])
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: 'repo-runtime-replaced' },
      },
    }))
    const generation = currentAppNavigationGeneration()

    await expect(selectTab('workspace-pane:files', navigationWith(), target.workspaceRuntimeId)).resolves.toBe(false)

    expect(target.workspaceRuntimeId).not.toBe('repo-runtime-replaced')
    expect(currentAppNavigationGeneration()).toBe(generation)
  })

  test('rebases the latest queued absolute selection after an earlier route commit', async () => {
    const target = seedTarget(['status', 'files', 'history'])
    observeStatusRoute(target)
    const showTab = storeBackedShowTab()
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(linkedLocation(target.workspaceRuntimeId), () => blocker.promise)

    const selectFiles = selectTab('workspace-pane:files', navigation)
    const selectHistory = selectTab('workspace-pane:history', navigation)
    blocker.resolve()
    await blockingAction

    await expect(selectFiles).resolves.toBe(false)
    await expect(selectHistory).resolves.toBe(true)
    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'static', tab: 'history' },
      expect.anything(),
    )
  })

  test('resolves each queued relative move from the route current at execution time', async () => {
    const target = seedTarget(['status', 'files', 'history'])
    observeStatusRoute(target)
    const showTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(linkedLocation(target.workspaceRuntimeId), () => blocker.promise)

    const firstMove = moveTab(navigation)
    const secondMove = moveTab(navigation)
    expect(showTab).not.toHaveBeenCalled()

    blocker.resolve()
    await blockingAction
    await expect(firstMove).resolves.toBe(true)
    await expect(secondMove).resolves.toBe(true)
    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledTimes(2)
    expect(vi.mocked(navigation.commitFilesystemWorkspacePaneRoute).mock.calls.map((call) => call[1])).toEqual([
      { kind: 'static', tab: 'files' },
      { kind: 'static', tab: 'history' },
    ])
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
    const blockingAction = runWorkspacePaneAction(linkedLocation(target.workspaceRuntimeId), () => blocker.promise)
    const queuedAction = dispatch(navigation)
    const generation = currentAppNavigationGeneration()

    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: 'repo-runtime-replaced' },
      },
    }))
    blocker.resolve()
    await blockingAction

    await expect(queuedAction).resolves.toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(showTab).not.toHaveBeenCalled()
  })

  test('keeps queued local navigation usable when canonical tabs become unavailable', async () => {
    const target = seedTarget(['status', 'files'])
    observeStatusRoute(target)
    const navigation = navigationWith({}, { autoSeedInitialRoute: false })
    const blocker = Promise.withResolvers<void>()
    const blockingAction = runWorkspacePaneAction(linkedLocation(target.workspaceRuntimeId), () => blocker.promise)
    const selection = selectTab('workspace-pane:files', navigation)

    await failWorkspacePaneTabsQueryForTest(REPO_ID, target.workspaceRuntimeId)
    blocker.resolve()
    await blockingAction

    await expect(selection).resolves.toBe(true)
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'static', tab: 'files' },
      expect.anything(),
    )
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
    const blockingAction = runWorkspacePaneAction(linkedLocation(target.workspaceRuntimeId), () => blocker.promise)
    const move = moveTab(navigation)
    const generation = currentAppNavigationGeneration()

    currentRoute = undefined
    blocker.resolve()
    await blockingAction

    await expect(move).resolves.toBe(false)
    expect(currentAppNavigationGeneration()).toBe(generation)
    expect(showTab).not.toHaveBeenCalled()
  })

  test('serializes open then move through exact route commits', async () => {
    const target = seedTarget(['status', 'history'])
    observeStatusRoute(target)
    const showTab = storeBackedShowTab()
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab: showTab }, { autoSeedInitialRoute: false })

    const openFiles = dispatchOpenWorkspacePaneStaticTabAction({
      workspaceId: REPO_ID,
      workspaceRuntimeId: target.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'files',
      workspacePaneRoute: { kind: 'static', tab: 'status' },
      navigation,
    })
    const move = moveTab(navigation)

    await expect(openFiles).resolves.toBe(true)
    await expect(move).resolves.toBe(true)
    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledTimes(2)
  })
})

function seedTarget(tabTypes: WorkspacePaneStaticTabType[]) {
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree')],
    worktrees: [createRepoWorktreeSnapshotForTest('feature/worktree', WORKTREE_PATH)],
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

function selectTab(
  identity: string,
  navigation: ObservedAppNavigationActionsForTest,
  workspaceRuntimeId = currentRuntimeId(),
) {
  return dispatchSelectWorkspacePaneTabByIdentityAction({
    location: linkedLocation(workspaceRuntimeId),
    workspaceId: REPO_ID,
    workspaceRuntimeId,
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    identity,
    navigation,
  })
}

function moveTab(navigation: ObservedAppNavigationActionsForTest) {
  return dispatchMoveWorkspacePaneTabAction({
    location: linkedLocation(),
    workspaceId: REPO_ID,
    workspaceRuntimeId: currentRuntimeId(),
    workspacePaneRoute: { kind: 'static', tab: 'status' },
    direction: 1,
    navigation,
  })
}

function linkedLocation(workspaceRuntimeId: string = currentRuntimeId()) {
  return workspacePaneLocationForLinkedWorktree(PANE_TARGET, workspaceRuntimeId, {
    kind: 'branch',
    branchName: 'feature/worktree',
  })
}

function currentRuntimeId(): string {
  const runtimeId = workspacesStore.getState().workspaces[REPO_ID]?.workspaceRuntimeId
  if (!runtimeId) throw new Error('missing workspace runtime fixture')
  return runtimeId
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
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
  })
}
