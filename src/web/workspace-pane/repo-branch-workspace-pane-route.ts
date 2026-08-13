import type { WorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoWorkspacePaneRouteNavigation } from '#/web/app-route-navigation.ts'
import { beginAppNavigation, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  createWorkspacePaneTabModel,
  isWorkspacePaneRuntimeTab,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export type WorkspacePaneRouteResolution =
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'snapshot-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
    }
  | { kind: 'route'; target: WorkspacePaneTabsTarget; route: WorkspacePaneRoute | null }

export function resolveWorkspacePaneRoute(repoId: WorkspaceId, branchName: string): WorkspacePaneRouteResolution {
  const state = workspacesStore.getState()
  const repo = state.workspaces[repoId]
  if (!repo || repo.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
  if (!branchModel) return { kind: 'unavailable', reason: 'snapshot-unavailable' }
  const target = workspacePaneTabsTargetForRepoBranch(
    { workspaceId: repo.id, branches: branchModel.branches, worktrees: branchModel.worktrees },
    branchName,
  )
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
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    filesystemTarget:
      target.kind === 'git-worktree'
        ? gitWorktreeFilesystemExecutionTarget(repo.id, repo.workspaceRuntimeId, target.worktreePath)
        : null,
  })
  const model = createWorkspacePaneTabModel({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    routeTarget: target,
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
  if (!activeTab) return { kind: 'route', target, route: null }
  if (isWorkspacePaneRuntimeTab(activeTab)) {
    if (activeTab.runtimeType === 'terminal') {
      return { kind: 'route', target, route: { kind: 'terminal', terminalSessionId: activeTab.sessionId } }
    }
    return { kind: 'route', target, route: null }
  }
  return { kind: 'route', target, route: { kind: 'static', tab: activeTab.type } }
}

export function openWorkspacePaneRoute(
  routeNavigation: RepoWorkspacePaneRouteNavigation,
  repoId: WorkspaceId,
  branchName: string,
  options?: { replace?: boolean; navigationGeneration?: AppNavigationGeneration; onCommit?: () => void },
): boolean {
  const resolution = resolveWorkspacePaneRoute(repoId, branchName)
  if (resolution.kind === 'missing') return false
  if (resolution.kind === 'unavailable' && resolution.reason === 'snapshot-unavailable') return false
  const navigationGeneration = options?.navigationGeneration ?? beginAppNavigation()
  const navigationOptions = { ...options, navigationGeneration }
  if (resolution.kind === 'unavailable') {
    return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, null, navigationOptions)
  }
  if (resolution.route?.kind === 'terminal') {
    return resolution.target.kind === 'git-worktree'
      ? routeNavigation.openRepoWorktreeTerminal(
          repoId,
          resolution.target.worktreePath,
          resolution.route.terminalSessionId,
          navigationOptions,
        )
      : false
  }
  return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, resolution.route, navigationOptions)
}
