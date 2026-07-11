import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneExactTargetRoute,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceStaticTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetReposStore()
    seedRepoWithReadModelForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-a' } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
    })
  })

  test('commits an exact target route without feature observation', async () => {
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, committingNavigation()),
    ).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/repo', 'feature/a', 'status')
  })

  test('rejects exact target completion after its runtime is replaced', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneTabControllerCommitNavigation = {
      commitRepoBranchWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    useReposStore.setState((state) => ({
      repos: { ...state.repos, '/repo': { ...state.repos['/repo']!, repoRuntimeId: 'repo-runtime-2' } },
    }))
    commit.resolve(true)
    await expect(completion).resolves.toBe(false)
  })

  test('normalizes a navigation rejection to false', async () => {
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, {
        commitRepoBranchWorkspacePaneRoute: vi.fn(async () => {
          throw new Error('router failed')
        }),
      }),
    ).resolves.toBe(false)
  })

  test('rejects completion when the target worktree changes while navigation settles', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneTabControllerCommitNavigation = {
      commitRepoBranchWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    const repo = useReposStore.getState().repos['/repo']!
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-b' } })],
      currentBranch: 'feature/a',
      status: [],
    })
    commit.resolve(true)

    await expect(completion).resolves.toBe(false)
  })

  test('commits a close-back lease through exact route completion', async () => {
    const lease = beginWorkspacePaneCloseActiveTabPresentationLease({
      target: workspacePaneTarget(),
      closingTab: staticTab('files'),
      nextTab: staticTab('status'),
      workspacePaneRoute: SOURCE_ROUTE,
    })
    if (!lease) throw new Error('missing presentation lease')
    await expect(commitWorkspacePaneControllerCloseBackTarget(lease, committingNavigation())).resolves.toBe(true)
  })
})

function workspacePaneTarget(): RepoWorkspaceTabModel {
  return {
    repoId: '/repo',
    repoRuntimeId: 'repo-runtime-1',
    branchName: 'feature/a',
    worktreePath: '/worktree-a',
  } as RepoWorkspaceTabModel
}

function committingNavigation(): WorkspacePaneTabControllerCommitNavigation {
  return {
    commitRepoBranchWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
      options?.onCommit?.()
      return true
    }),
  }
}

function staticTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  return { identity: workspacePaneStaticTabId(type), type, kind: 'static', view: null }
}
