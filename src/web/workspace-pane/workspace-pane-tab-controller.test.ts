import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneCurrentTargetRoute,
  observeWorkspacePaneTabControllerRoute,
  resetWorkspacePaneTabControllerForTest,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneStaticTabId, type WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceStaticTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    resetWorkspacePaneTabControllerForTest()
  })

  test('accepted navigation stays pending until the exact route is observed', async () => {
    const target = workspacePaneTarget()
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const navigation = { commitRepoBranchWorkspacePaneRoute: vi.fn(() => true) }
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
  })

  test('rejects accepted navigation when the observer reaches a different route', async () => {
    const target = workspacePaneTarget()
    observeWorkspacePaneTabControllerRoute({ ...target, route: SOURCE_ROUTE })
    const committed = commitWorkspacePaneCurrentTargetRoute(
      target,
      SOURCE_ROUTE,
      TARGET_ROUTE,
      { commitRepoBranchWorkspacePaneRoute: vi.fn(() => true) },
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
      { commitRepoBranchWorkspacePaneRoute: vi.fn(() => true) },
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
    const navigation = { commitRepoBranchWorkspacePaneRoute: vi.fn(() => true) }
    const committed = commitWorkspacePaneControllerCloseBackTarget(lease, navigation)

    await Promise.resolve()
    expect(navigation.commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledWith(
      target.repoId,
      target.branchName,
      TARGET_ROUTE,
      undefined,
    )
    observeWorkspacePaneTabControllerRoute({ ...target, route: TARGET_ROUTE })
    await expect(committed).resolves.toBe(true)
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

function staticTab(type: WorkspacePaneStaticTabType): RepoWorkspaceStaticTab {
  return {
    identity: workspacePaneStaticTabId(type),
    type,
    kind: 'static',
    view: null,
  }
}
