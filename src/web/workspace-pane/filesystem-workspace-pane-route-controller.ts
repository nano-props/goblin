import { useEffect, useMemo } from 'react'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'

// Filesystem routes follow the same authority rule as Git routes: the URL
// selects a pane, and projection state only validates whether it can render.
export function useFilesystemWorkspacePaneRouteController(input: {
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
}): WorkspacePaneRouteReconciliation {
  const { route, model } = input
  const reconciliation = useMemo(() => reconcileWorkspacePaneRoute(route, model), [route, model])

  useFilesystemWorkspacePaneNavigationHistory({ route, model, reconciliation })
  useSyncRoutedFilesystemWorkspacePanePreference({ route, model, reconciliation })
  useSyncWorkspacePaneRuntimeTabSelection(model, { enabled: reconciliation.kind === 'none' })

  return reconciliation
}

function useSyncRoutedFilesystemWorkspacePanePreference(input: {
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const { route, model, reconciliation } = input
  const setWorkspacePaneTabForTarget = useWorkspacesStore((state) => state.setWorkspacePaneTabForTarget)
  useEffect(() => {
    if (reconciliation.kind !== 'none' || route === null || route.kind === 'invalid-static') return
    const target = model.routeTarget
    if (target.kind !== 'workspace-root' && target.kind !== 'git-worktree') return
    const workspace = useWorkspacesStore.getState().workspaces[target.workspaceId]
    if (!workspace || workspace.workspaceRuntimeId !== model.workspaceRuntimeId) return
    const routedTab = route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(workspace.ui, target) !== routedTab) {
      setWorkspacePaneTabForTarget(target, routedTab)
    }
  }, [model.routeTarget, model.workspaceRuntimeId, reconciliation.kind, route, setWorkspacePaneTabForTarget])
}

function useFilesystemWorkspacePaneNavigationHistory(input: {
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const { route, model, reconciliation } = input
  const historyRoute = workspacePaneRouteHistoryResolution(route, reconciliation)
  useWorkspaceNavigationHistory({
    routeContext:
      historyRoute.kind === 'record' ? filesystemWorkspacePaneHistoryRouteContext(model, historyRoute.route) : null,
  })
}

function filesystemWorkspacePaneHistoryRouteContext(
  model: WorkspacePaneTabModel,
  workspacePaneRoute: WorkspacePaneRouteTarget,
): WorkspaceNavigationRouteContext | null {
  if (model.routeTarget.kind === 'workspace-root') {
    return {
      kind: 'workspace-root',
      workspaceId: model.workspaceId,
      workspacePaneRoute,
    }
  }
  if (model.routeTarget.kind === 'git-worktree') {
    return {
      kind: 'worktree',
      workspaceId: model.workspaceId,
      worktreePath: model.routeTarget.worktreePath,
      workspacePaneRoute,
    }
  }
  return null
}
