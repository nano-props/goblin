import { beforeEach, expect, test } from 'vitest'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { closeWorkspacePaneTabsForWorktree } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  resetWorkspacePaneTabCoordinatorForTest,
  runWorkspacePaneTabCoordinatorTask,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { createRepoBranch, installWorkspacePaneTabsTestBridge, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'

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
