import type { WorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
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
import {
  workspacePaneTabsTargetWorktreePath,
} from '#/shared/workspace-pane-tabs-target.ts'

export type WorkspacePaneRouteResolution =
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'branch-read-model-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
    }
  | { kind: 'route'; route: WorkspacePaneRoute | null }

export function resolveWorkspacePaneRoute(
  repoId: string,
  branchName: string,
): WorkspacePaneRouteResolution {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchSnapshotQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const target = workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: branchModel.branches }, branchName)
  if (!target) return { kind: 'missing' }
  const tabEntriesProjection = readWorkspacePaneTabsProjectionForTarget({
    ...target,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  })
  if (tabEntriesProjection.phase !== 'ready') {
    return {
      kind: 'unavailable',
      reason: tabEntriesProjection.phase === 'failed' ? 'workspace-pane-tabs-failed' : 'workspace-pane-tabs-pending',
    }
  }
  const runtimeProjection = readWorkspacePaneRuntimeTabTargetProjection({
    repoRoot: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: workspacePaneTabsTargetWorktreePath(target),
  })
  const model = createRepoWorkspaceTabModel({
    repoId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreeHead: target.kind === 'git-worktree' ? { kind: 'branch', branchName } : undefined,
    paneTarget: target,
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

export function openWorkspacePaneRoute(
  routeNavigation: Pick<
    PrimaryWindowRouteNavigation,
    'openRepoBranch' | 'openRepoBranchTab' | 'openRepoBranchTerminal'
  >,
  repoId: string,
  branchName: string,
  options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
): boolean {
  const resolution = resolveWorkspacePaneRoute(repoId, branchName)
  if (resolution.kind === 'missing') return false
  if (resolution.kind === 'unavailable') {
    if (resolution.reason === 'branch-read-model-unavailable') return false
    return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, null, options)
  }
  return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, resolution.route, options)
}
