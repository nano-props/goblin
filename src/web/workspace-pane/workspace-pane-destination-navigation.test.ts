import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  commitWorkspacePaneDestinationRoute,
  dispatchWorkspacePaneDestinationRoute,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import {
  resolveWorkspacePaneDestinationTargetLease,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  observeWorkspacePaneTabControllerRoute,
  resetWorkspacePaneTabControllerForTest,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/gbl-destination-navigation-repo'
const CURRENT_WORKTREE = '/tmp/gbl-destination-current-worktree'
const DESTINATION_WORKTREE = '/tmp/gbl-destination-target-worktree'
const DESTINATION_ROUTE = { kind: 'static' as const, tab: 'status' as const }

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  resetWorkspacePaneTabControllerForTest()
})

describe('workspace pane destination navigation', () => {
  test('commits an absolute destination without a mounted route controller', async () => {
    seedDestinationRepo()
    const commitRepoBranchWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        repoId: REPO_ID,
        branchName: 'feature/destination',
        route: DESTINATION_ROUTE,
        navigation: { commitRepoBranchWorkspacePaneRoute },
      }),
    ).resolves.toBe(true)

    expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
      REPO_ID,
      'feature/destination',
      DESTINATION_ROUTE,
      undefined,
    )
  })

  test('does not navigate without a live worktree identity', async () => {
    const branch = createRepoBranch('feature/no-worktree')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/no-worktree',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [branch],
      currentBranch: 'feature/no-worktree',
    })
    const commitRepoBranchWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        route: DESTINATION_ROUTE,
        navigation: { commitRepoBranchWorkspacePaneRoute },
      }),
    ).resolves.toBe(false)
    expect(commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('ignores a different branch controller when navigating cross-target', async () => {
    const repo = seedDestinationRepo()
    observeWorkspacePaneTabControllerRoute({
      repoId: REPO_ID,
      repoRuntimeId: repo.repoRuntimeId,
      branchName: 'feature/current',
      worktreePath: CURRENT_WORKTREE,
      route: { kind: 'static', tab: 'files' },
    })
    const commitRepoBranchWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        repoId: REPO_ID,
        branchName: 'feature/destination',
        route: DESTINATION_ROUTE,
        navigation: { commitRepoBranchWorkspacePaneRoute },
      }),
    ).resolves.toBe(true)
    expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledOnce()
  })

  test('rejects a stale runtime lease before route commit', async () => {
    seedDestinationRepo()
    const lease = resolveWorkspacePaneDestinationTargetLease(REPO_ID, 'feature/destination')
    if (!lease) throw new Error('missing destination lease')
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      return {
        repos: {
          ...state.repos,
          [REPO_ID]: { ...repo, repoRuntimeId: 'repo-runtime-reopened' },
        },
      }
    })
    const commitRepoBranchWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      commitWorkspacePaneDestinationRoute(lease, DESTINATION_ROUTE, { commitRepoBranchWorkspacePaneRoute }),
    ).resolves.toBe(false)
    expect(commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('revalidates worktree identity after transaction work', async () => {
    const repo = seedDestinationRepo()
    const lease = resolveWorkspacePaneDestinationTargetLease(REPO_ID, 'feature/destination')
    if (!lease) throw new Error('missing destination lease')
    seedRepoReadModelQueryData(repo, {
      branches: [
        createRepoBranch('feature/current', { worktree: { path: CURRENT_WORKTREE } }),
        createRepoBranch('feature/destination', { worktree: { path: '/tmp/gbl-destination-replaced-worktree' } }),
      ],
      currentBranch: 'feature/current',
    })
    const commitRepoBranchWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      commitWorkspacePaneDestinationRoute(lease, DESTINATION_ROUTE, { commitRepoBranchWorkspacePaneRoute }),
    ).resolves.toBe(false)
    expect(commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  })
})

function seedDestinationRepo() {
  const current = createRepoBranch('feature/current', { worktree: { path: CURRENT_WORKTREE } })
  const destination = createRepoBranch('feature/destination', { worktree: { path: DESTINATION_WORKTREE } })
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [current, destination],
    currentBranchName: 'feature/current',
  })
  seedRepoReadModelQueryData(repo, {
    branches: [current, destination],
    currentBranch: 'feature/current',
  })
  return repo
}
