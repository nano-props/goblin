import { computed, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'

// Filesystem routes follow the same authority rule as Git routes: the URL
// selects a pane, and projection state only validates whether it can render.
export function useFilesystemWorkspacePaneRouteController(input: {
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  model: MaybeRefOrGetter<WorkspacePaneTabModel>
}): ComputedRef<WorkspacePaneRouteReconciliation> {
  const reconciliation = computed(() => reconcileWorkspacePaneRoute(toValue(input.route), toValue(input.model)))

  useFilesystemWorkspacePaneNavigationHistory({ ...input, reconciliation })
  useSyncRoutedFilesystemWorkspacePanePreference({ ...input, reconciliation })
  useSyncWorkspacePaneRuntimeTabSelection(input.model, {
    enabled: computed(() => reconciliation.value.kind === 'none'),
  })

  return reconciliation
}

function useSyncRoutedFilesystemWorkspacePanePreference(input: {
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  model: MaybeRefOrGetter<WorkspacePaneTabModel>
  reconciliation: MaybeRefOrGetter<WorkspacePaneRouteReconciliation>
}): void {
  const setWorkspacePaneTabForTarget = workspacesStore.getState().setWorkspacePaneTabForTarget
  // A settled valid route is the authority for the persisted preferred tab.
  watch(
    [() => toValue(input.route), () => toValue(input.model), () => toValue(input.reconciliation)],
    () => {
      const route = toValue(input.route)
      const model = toValue(input.model)
      const reconciliation = toValue(input.reconciliation)
      if (reconciliation.kind !== 'none' || route === null || route.kind === 'invalid-static') return
      const target = model.routeTarget
      if (target.kind !== 'workspace-root' && target.kind !== 'git-worktree') return
      const workspace = workspacesStore.getState().workspaces[target.workspaceId]
      if (!workspace || workspace.workspaceRuntimeId !== model.workspaceRuntimeId) return
      const routedTab = route.kind === 'static' ? route.tab : 'terminal'
      if (preferredWorkspacePaneTabForTarget(workspace.ui, target) !== routedTab) {
        setWorkspacePaneTabForTarget(target, routedTab)
      }
    },
    { immediate: true },
  )
}

function useFilesystemWorkspacePaneNavigationHistory(input: {
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  model: MaybeRefOrGetter<WorkspacePaneTabModel>
  reconciliation: MaybeRefOrGetter<WorkspacePaneRouteReconciliation>
}): void {
  const routeContext = computed(() => {
    const historyRoute = workspacePaneRouteHistoryResolution(toValue(input.route), toValue(input.reconciliation))
    return historyRoute.kind === 'record'
      ? filesystemWorkspacePaneHistoryRouteContext(toValue(input.model), historyRoute.route)
      : null
  })
  useWorkspaceNavigationHistory({
    routeContext,
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
