import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneExactTargetRoute,
  commitWorkspacePaneCurrentTargetRoute,
  observeWorkspacePaneTabControllerRoute,
  resetWorkspacePaneTabControllerForTest,
  type WorkspacePaneTabControllerCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceStaticTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetReposStore()
    resetWorkspacePaneTabControllerForTest()
    seedRepoWithReadModelForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-1',
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-a' } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
    })
  })

  test('accepted navigation stays pending until the exact route is observed', async () => {
    const target = workspacePaneTarget()
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const navigation = committingNavigation()
    const committed = commitWorkspacePaneCurrentTargetRoute(
      target,
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    let settled = false
    void committed.then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(navigation.commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    observeWorkspacePaneTabControllerRoute({ ...target, route: TARGET_ROUTE })
    await expect(committed).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/repo', 'feature/a', 'status')
  })

  test('commits an exact target route without feature route observation', async () => {
    const target = workspacePaneTarget()
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')

    await expect(
      commitWorkspacePaneExactTargetRoute(target, SOURCE_ROUTE, TARGET_ROUTE, committingNavigation()),
    ).resolves.toBe(true)

    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/repo', 'feature/a', 'status')
  })

  test('rejects exact target route completion after its runtime is replaced', async () => {
    const target = workspacePaneTarget()
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneTabControllerCommitNavigation = {
      commitRepoBranchWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(target, SOURCE_ROUTE, TARGET_ROUTE, navigation)
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        '/repo': { ...state.repos['/repo']!, repoRuntimeId: 'repo-runtime-2' },
      },
    }))
    commit.resolve(true)

    await expect(completion).resolves.toBe(false)
  })

  test('rejects accepted navigation when the observer reaches a different route', async () => {
    const target = workspacePaneTarget()
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const committed = commitWorkspacePaneCurrentTargetRoute(
      target,
      SOURCE_ROUTE,
      TARGET_ROUTE,
      committingNavigation(),
    )

    observeWorkspacePaneTabControllerRoute({
      ...target,
      route: { kind: 'static', tab: 'history' },
    })

    await expect(committed).resolves.toBe(false)
  })

  test('rejects a pending commit when a replacement runtime is observed', async () => {
    const target = workspacePaneTarget()
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const committed = commitWorkspacePaneCurrentTargetRoute(
      target,
      SOURCE_ROUTE,
      TARGET_ROUTE,
      committingNavigation(),
    )

    observeWorkspacePaneTabControllerRoute({
      ...target,
      repoRuntimeId: 'repo-runtime-2',
      route: SOURCE_ROUTE,
    })

    await expect(committed).resolves.toBe(false)
  })

  test('commits a close presentation lease through observer confirmation', async () => {
    const target = workspacePaneTarget()
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')
    const closingTab = staticTab('files')
    const nextTab = staticTab('status')
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const lease = beginWorkspacePaneCloseActiveTabPresentationLease({
      target,
      closingTab,
      nextTab,
      workspacePaneRoute: SOURCE_ROUTE,
    })
    if (!lease) throw new Error('missing presentation lease')
    const navigation = committingNavigation()
    const committed = commitWorkspacePaneControllerCloseBackTarget(lease, navigation)

    await Promise.resolve()
    expect(navigation.commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
      target.repoId,
      target.branchName,
      TARGET_ROUTE,
      expect.objectContaining({ presentationToken: expect.any(Object) }),
    )
    observeWorkspacePaneTabControllerRoute({ ...target, route: TARGET_ROUTE })
    await expect(committed).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/repo', 'feature/a', 'status')
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
  return {
    identity: workspacePaneStaticTabId(type),
    type,
    kind: 'static',
    view: null,
  }
}
