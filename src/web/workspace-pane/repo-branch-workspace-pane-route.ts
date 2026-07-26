import type { WorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import type { PrimaryWindowNavigationGeneration } from '#/web/primary-window-navigation-lifecycle.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  createWorkspacePaneTabModel,
  isWorkspacePaneRuntimeTab,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { readSuccessfulRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { readWorkspacePaneRuntimeTabTargetProjection } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'

export type WorkspacePaneRouteResolution =
  | { kind: 'missing' }
  | {
      kind: 'unavailable'
      reason: 'branch-read-model-unavailable' | 'workspace-pane-tabs-pending' | 'workspace-pane-tabs-failed'
    }
  | { kind: 'route'; route: WorkspacePaneRoute | null }

export function resolveWorkspacePaneRoute(repoId: WorkspaceId, branchName: string): WorkspacePaneRouteResolution {
  const state = useWorkspacesStore.getState()
  const repo = state.workspaces[repoId]
  if (!repo || repo.capability.kind !== 'git') return { kind: 'missing' }
  const branchModel = readSuccessfulRepoBranchSnapshotQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const target = workspacePaneTabsTargetForRepoBranch(
    { workspaceId: repo.id, branches: branchModel.branches },
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
    routeTarget: { kind: 'git-branch', workspaceId: repo.id, branchName },
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
  if (isWorkspacePaneRuntimeTab(activeTab)) {
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
  repoId: WorkspaceId,
  branchName: string,
  options?: { replace?: boolean; navigationGeneration?: PrimaryWindowNavigationGeneration; onCommit?: () => void },
): boolean {
  const resolution = resolveWorkspacePaneRoute(repoId, branchName)
  if (resolution.kind === 'missing') return false
  if (resolution.kind === 'unavailable') {
    if (resolution.reason === 'branch-read-model-unavailable') return false
    return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, null, options)
  }
  return openResolvedWorkspacePaneRoute(routeNavigation, repoId, branchName, resolution.route, options)
}
