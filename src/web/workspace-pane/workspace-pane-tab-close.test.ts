import { beforeEach, expect, test, vi } from 'vitest'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { dispatchCloseWorkspacePaneTabAction } from '#/web/workspace-pane/workspace-pane-tab-close-action.ts'
import { closeWorkspacePaneTabsForWorktree } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  resetWorkspacePaneTabCoordinatorForTest,
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/workspace-pane-tab-close-repo'
const BRANCH_NAME = 'feature/worktree-close'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-close-worktree'

beforeEach(() => {
  resetWorkspacePaneTabCoordinatorForTest()
  primaryWindowQueryClient.clear()
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
})

test('queues worktree tab close behind in-flight workspace pane tab operations', async () => {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'files',
    workspacePaneTabsByBranch: {
      [BRANCH_NAME]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    },
  })
  let updateCalled = false
  installWorkspacePaneTabsTestBridge({
    updateWorkspaceTabs: (input) => {
      updateCalled = true
      expect(input.operation).toEqual({ type: 'close-static', tabType: 'files' })
      return [workspacePaneStaticTabEntry('status')]
    },
  })

  let releaseBlocker!: () => void
  const blocker = runWorkspacePaneTabCoordinatorTask(
    { repoId: REPO_ID, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    async () =>
      await new Promise<void>((resolve) => {
        releaseBlocker = resolve
      }),
  )
  await Promise.resolve()

  let closeSettled = false
  const closePromise = closeWorkspacePaneTabsForWorktree({
    repoId: REPO_ID,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  }).then((result) => {
    closeSettled = true
    return result
  })
  await Promise.resolve()

  expect(updateCalled).toBe(false)
  expect(closeSettled).toBe(false)

  releaseBlocker()
  await blocker

  await expect(closePromise).resolves.toBe(true)
  expect(updateCalled).toBe(true)
})

test('commits active close-back route through command-owned navigation', async () => {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'files',
    workspacePaneTabsByBranch: {
      [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
    },
  })
  const showRepoBranchWorkspacePaneTab = vi.fn(() => false)
  const commitRepoBranchWorkspacePaneRoute = vi.fn(() => true)

  await expect(
    dispatchCloseWorkspacePaneTabAction({
      repoId: REPO_ID,
      branchName: BRANCH_NAME,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation: navigationWith({
        showRepoBranchWorkspacePaneTab,
        commitRepoBranchWorkspacePaneRoute,
      }),
    }),
  ).resolves.toBe(true)

  expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
    REPO_ID,
    BRANCH_NAME,
    { kind: 'static', tab: 'status' },
    undefined,
  )
  expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
})

test('awaits close-back navigation and clears the transition when navigation rejects', async () => {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'files',
    workspacePaneTabsByBranch: {
      [BRANCH_NAME]: [workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('status')],
    },
  })
  const routeCommit = Promise.withResolvers<boolean>()
  const commitRepoBranchWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
  const close = dispatchCloseWorkspacePaneTabAction({
    repoId: REPO_ID,
    branchName: BRANCH_NAME,
    workspacePaneRoute: { kind: 'static', tab: 'files' },
    navigation: navigationWith({ commitRepoBranchWorkspacePaneRoute }),
  })

  await vi.waitFor(() => expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledOnce())
  const repoRuntimeId = useReposStore.getState().repos[REPO_ID]?.repoRuntimeId
  expect(repoRuntimeId).toBeTruthy()
  expect(
    workspacePaneTabCoordinatorReconciliationDeferred({
      repoId: REPO_ID,
      repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'files' },
      reconciliation: { kind: 'replace-empty-pane' },
    }),
  ).toBe(true)

  routeCommit.reject(new Error('navigation failed'))
  await expect(close).resolves.toBe(false)
  expect(
    workspacePaneTabCoordinatorReconciliationDeferred({
      repoId: REPO_ID,
      repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'files' },
      reconciliation: { kind: 'replace-empty-pane' },
    }),
  ).toBe(false)
})

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: vi.fn(),
    closeRepo: vi.fn(),
    cycleRepo: vi.fn(),
    selectRepoBranch: vi.fn(() => true),
    showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
    showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    showRepoBranchTerminalSession: vi.fn(() => true),
    commitRepoBranchWorkspacePaneRoute: vi.fn(() => true),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
  }
}
