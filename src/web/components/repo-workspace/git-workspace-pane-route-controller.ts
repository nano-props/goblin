import { computed, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type {
  BranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRouteTarget,
} from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneModelTarget } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/workspace-pane/workspace-pane-route-reconciliation.ts'

export interface GitWorkspacePaneRouteControllerInput {
  enabled?: MaybeRefOrGetter<boolean>
  workspaceId: MaybeRefOrGetter<WorkspaceId>
  branchName: MaybeRefOrGetter<string | null>
  worktreePath: MaybeRefOrGetter<string | null>
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  model: MaybeRefOrGetter<WorkspacePaneTabModel>
}

// URL is the presentation authority. Reconciliation validates whether the
// requested route can render; it never chooses another route in an effect.
export function useGitWorkspacePaneRouteController(
  input: GitWorkspacePaneRouteControllerInput,
): ComputedRef<WorkspacePaneRouteReconciliation> {
  const enabled = () => toValue(input.enabled ?? true)
  const reconciliation = computed<WorkspacePaneRouteReconciliation>(() =>
    enabled() ? reconcileWorkspacePaneRoute(toValue(input.route), toValue(input.model)) : { kind: 'none' },
  )
  useWorkspacePaneNavigationHistory({
    ...input,
    enabled,
    reconciliation,
  })
  useSyncRoutedWorkspacePaneSelection({
    ...input,
    enabled,
    reconciliation,
  })
  useSyncWorkspacePaneRuntimeTabSelection(input.model, {
    enabled: computed(() => enabled() && reconciliation.value.kind === 'none'),
  })
  return reconciliation
}

function useWorkspacePaneNavigationHistory({
  enabled,
  workspaceId,
  route,
  reconciliation,
  model,
}: {
  enabled: MaybeRefOrGetter<boolean>
  workspaceId: MaybeRefOrGetter<WorkspaceId>
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  reconciliation: MaybeRefOrGetter<WorkspacePaneRouteReconciliation>
  model: MaybeRefOrGetter<WorkspacePaneTabModel>
}): void {
  const routeContext = computed(() => {
    const historyRoute = workspacePaneRouteHistoryResolution(toValue(route) ?? null, toValue(reconciliation))
    const currentModel = toValue(model)
    return toValue(enabled) && historyRoute.kind === 'record'
      ? workspacePaneHistoryRouteContext({
          workspaceId: toValue(workspaceId),
          routeTarget: currentModel.routeTarget,
          route: historyRoute.route,
        })
      : null
  })
  useWorkspaceNavigationHistory({
    routeContext,
  })
}

function workspacePaneHistoryRouteContext({
  workspaceId,
  routeTarget,
  route,
}: {
  workspaceId: WorkspaceId
  routeTarget: WorkspacePaneModelTarget
  route: WorkspacePaneRouteTarget
}): WorkspaceNavigationRouteContext | null {
  if (routeTarget.kind === 'git-worktree') {
    return { kind: 'worktree', workspaceId, worktreePath: routeTarget.worktreePath, workspacePaneRoute: route }
  }
  if (routeTarget.kind === 'git-branch') {
    if (route?.kind === 'terminal') throw new Error('branch history cannot record runtime tabs')
    const branchRoute: BranchWorkspacePaneRouteTarget = route
    return {
      kind: 'branch',
      workspaceId,
      branchName: routeTarget.branchName,
      workspacePaneRoute: branchRoute,
    }
  }
  return null
}

function useSyncRoutedWorkspacePaneSelection({
  enabled,
  workspaceId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: MaybeRefOrGetter<boolean>
  workspaceId: MaybeRefOrGetter<WorkspaceId>
  branchName: MaybeRefOrGetter<string | null>
  worktreePath: MaybeRefOrGetter<string | null>
  route: MaybeRefOrGetter<ParsedWorkspacePaneRouteTarget>
  reconciliation: MaybeRefOrGetter<WorkspacePaneRouteReconciliation>
}): void {
  const setWorkspacePaneTab = workspacesStore.getState().setWorkspacePaneTab
  // Persist only a valid settled route selection; reconciliation never chooses it.
  watch(
    [
      () => toValue(enabled),
      () => toValue(workspaceId),
      () => toValue(branchName),
      () => toValue(worktreePath),
      () => toValue(route),
      () => toValue(reconciliation),
    ],
    () => {
      if (!toValue(enabled)) return
      const currentBranchName = toValue(branchName)
      if (!currentBranchName || toValue(reconciliation).kind !== 'none') return
      const currentWorkspaceId = toValue(workspaceId)
      const state = workspacesStore.getState()
      const repo = state.workspaces[currentWorkspaceId]
      if (!repo) return
      const target = requiredGitWorkspacePaneTabsTarget(currentWorkspaceId, currentBranchName, toValue(worktreePath))
      const currentRoute = toValue(route)
      if (currentRoute === null && target.kind === 'git-worktree') return
      if (currentRoute?.kind === 'invalid-static') return
      const routeTab = currentRoute === null ? null : currentRoute.kind === 'static' ? currentRoute.tab : 'terminal'
      if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
        setWorkspacePaneTab(currentWorkspaceId, currentBranchName, routeTab)
      }
    },
    { immediate: true },
  )
}
