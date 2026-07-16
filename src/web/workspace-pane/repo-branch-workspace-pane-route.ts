import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  createRepoWorkspaceTabModel,
  isRepoWorkspaceRuntimeTab,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export type RepoBranchWorkspacePaneRouteResolution =
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'branch-read-model-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
    }
  | { kind: 'route'; route: RepoBranchWorkspacePaneRoute | null }

export function resolveRepoBranchWorkspacePaneRoute(
  repoId: string,
  branchName: string,
): RepoBranchWorkspacePaneRouteResolution {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchSnapshotQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const target = workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: branchModel.branches }, branchName)
  if (!target) return { kind: 'missing' }
  const tabEntriesProjection = readWorkspacePaneTabsProjectionForTarget({
    ...target,
    repoRuntimeId: repo.repoRuntimeId,
  })
  if (tabEntriesProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabEntriesProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
    }
  }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    worktreePath: target.worktreePath,
  })
  const model = createRepoWorkspaceTabModel({
    repoId: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
    preferredTab: preferredWorkspacePaneTabForTarget(repo.ui, target),
    allowPreferredTabFallback: true,
    tabEntries: tabEntriesProjection.tabs,
    tabEntriesProjectionPhase: tabEntriesProjection.phase,
    runtimeTabViews: runtimeProjection.runtimeTabViews,
    runtimeTabStateByType: runtimeProjection.runtimeTabStateByType,
  })
  const activeTab = model.activeTab
  if (!activeTab) return { kind: 'route', route: null }
  if (isRepoWorkspaceRuntimeTab(activeTab)) {
    if (activeTab.runtimeType === 'terminal') {
      return { kind: 'route', route: { kind: 'terminal', terminalSessionId: activeTab.sessionId } }
    }
    return { kind: 'route', route: null }
  }
  return { kind: 'route', route: { kind: 'static', tab: activeTab.type } }
}

export function openRepoBranchWorkspacePaneRoute(
  routeNavigation: Pick<
    PrimaryWindowRouteNavigation,
    'openRepoBranch' | 'openRepoBranchTab' | 'openRepoBranchTerminal'
  >,
  repoId: string,
  branchName: string,
  options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
): boolean {
  const resolution = resolveRepoBranchWorkspacePaneRoute(repoId, branchName)
  if (resolution.kind === 'missing' || resolution.kind === 'unavailable') return false
  return openResolvedRepoBranchWorkspacePaneRoute(routeNavigation, repoId, branchName, resolution.route, options)
}
