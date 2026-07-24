import { useEffect, useMemo } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'

export interface GitWorkspacePaneRouteControllerInput {
  enabled?: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
}

// URL is the presentation authority. Reconciliation validates whether the
// requested route can render; it never chooses another route in an effect.
export function useGitWorkspacePaneRouteController({
  enabled = true,
  workspaceId,
  branchName,
  worktreePath,
  route,
  model,
}: GitWorkspacePaneRouteControllerInput): WorkspacePaneRouteReconciliation {
  const reconciliation = useMemo(
    () => (enabled ? reconcileWorkspacePaneRoute(route, model) : { kind: 'none' as const }),
    [enabled, route, model],
  )
  useWorkspacePaneNavigationHistory({
    enabled,
    workspaceId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncRoutedWorkspacePaneSelection({
    enabled,
    workspaceId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncWorkspacePaneRuntimeTabSelection(model, { enabled: enabled && reconciliation.kind === 'none' })
  return reconciliation
}

function useWorkspacePaneNavigationHistory({
  enabled,
  workspaceId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const historyRoute = workspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  useWorkspaceNavigationHistory({
    routeContext:
      enabled && branchName && historyRoute.kind === 'record'
        ? workspacePaneHistoryRouteContext({ workspaceId, branchName, worktreePath, route: historyRoute.route })
        : null,
  })
}

function workspacePaneHistoryRouteContext({
  workspaceId,
  branchName,
  worktreePath,
  route,
}: {
  workspaceId: WorkspaceId
  branchName: string
  worktreePath: string | null
  route: WorkspacePaneRouteTarget
}): WorkspaceNavigationRouteContext {
  return {
    kind: 'branch',
    workspaceId,
    branchName,
    worktreePath,
    workspacePaneRoute: route,
  }
}

function useSyncRoutedWorkspacePaneSelection({
  enabled,
  workspaceId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const setWorkspacePaneTab = useWorkspacesStore((s) => s.setWorkspacePaneTab)
  useEffect(() => {
    if (!enabled) return
    if (!branchName) return
    if (reconciliation.kind !== 'none') return
    const state = useWorkspacesStore.getState()
    const repo = state.workspaces[workspaceId]
    if (!repo) return
    const target = requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath)
    if (route?.kind === 'invalid-static') return
    const routeTab = route === null ? null : route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(workspaceId, branchName, routeTab)
    }
  }, [branchName, enabled, reconciliation.kind, workspaceId, route, setWorkspacePaneTab, worktreePath])
}
