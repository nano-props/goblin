import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { usePrimaryWindowNavigation, type PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useSyncWorkspacePaneRuntimeTabSelection } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import {
  reconcileGitWorkspacePaneRoute,
  gitWorkspacePaneRouteHistoryResolution,
  type GitWorkspacePaneRouteReconciliation,
} from '#/web/components/repo-workspace/git-workspace-pane-route-reconciliation.ts'
import { commitWorkspacePaneControllerRoute } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  subscribeWorkspacePaneRouteIntents,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacePaneRouteKey } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'

export interface GitWorkspacePaneRouteControllerInput {
  enabled?: boolean
  workspaceId: WorkspaceId
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  model: WorkspacePaneTabModel
}

// Single side-effect boundary for URL-backed workspace-pane routes.
// Data flows from server/projection model -> route reconciliation -> app
// history -> validated preference sync -> canonical route replacement.
// Keep this ordering intact so browser Back/Forward metadata is consumed
// before a stale URL is replaced.
export function useGitWorkspacePaneRouteController({
  enabled = true,
  workspaceId,
  branchName,
  worktreePath,
  route,
  model,
}: GitWorkspacePaneRouteControllerInput): GitWorkspacePaneRouteReconciliation {
  const navigation = usePrimaryWindowNavigation()
  const reconciliation = useMemo(
    () => (enabled ? reconcileGitWorkspacePaneRoute(route, model) : { kind: 'none' as const }),
    [enabled, route, model],
  )
  const routeIntentPending = useSyncExternalStore(
    subscribeWorkspacePaneRouteIntents,
    () =>
      route?.kind !== 'invalid-static' &&
      workspacePaneRouteIntentPending(
        workspacePaneActionTargetFromCoordinates({
          workspaceId,
          workspaceRuntimeId: model.workspaceRuntimeId,
          branchName,
          worktreePath,
        }),
        workspacePaneRouteKey(route),
      ),
    () => false,
  )
  const effectiveReconciliation =
    routeIntentPending && reconciliation.kind === 'replace-empty-pane' ? ({ kind: 'pending' } as const) : reconciliation

  useWorkspacePaneNavigationHistory({
    enabled,
    workspaceId,
    branchName,
    worktreePath,
    route,
    reconciliation: effectiveReconciliation,
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
  useReconcileWorkspacePaneRoute({
    enabled,
    workspaceId,
    workspaceRuntimeId: model.workspaceRuntimeId,
    branchName,
    worktreePath,
    route,
    reconciliation,
    routeIntentPending,
    navigation,
  })

  return reconciliation
}

function useReconcileWorkspacePaneRoute({
  enabled,
  workspaceId,
  workspaceRuntimeId,
  branchName,
  worktreePath,
  route,
  reconciliation,
  routeIntentPending,
  navigation,
}: {
  enabled: boolean
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: GitWorkspacePaneRouteReconciliation
  routeIntentPending: boolean
  navigation: PrimaryWindowNavigationActions
}): void {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates({ workspaceId, workspaceRuntimeId, branchName, worktreePath }),
      () => {
        if (cancelled) return
        if (!branchName) return
        if (routeIntentPending && reconciliation.kind === 'replace-empty-pane') return
        applyGitWorkspacePaneRouteReconciliation({ workspaceId, branchName, reconciliation, navigation })
      },
    )
    return () => {
      cancelled = true
    }
  }, [
    branchName,
    enabled,
    navigation,
    reconciliation,
    workspaceId,
    workspaceRuntimeId,
    routeIntentPending,
    worktreePath,
  ])
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
  reconciliation: GitWorkspacePaneRouteReconciliation
}): void {
  const historyRoute = gitWorkspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  const replaceCurrentRoute = workspacePaneValidRouteTarget(route)
  const replaceCurrentRouteContext =
    branchName && reconciliation.kind === 'replace-empty-pane'
      ? workspacePaneHistoryRouteContext({
          workspaceId,
          branchName,
          worktreePath,
          route: replaceCurrentRoute,
        })
      : null
  useWorkspaceNavigationHistory({
    replaceCurrent: reconciliation.kind === 'replace-empty-pane',
    replaceCurrentRouteContext,
    routeContext:
      enabled && branchName && historyRoute.kind === 'record'
        ? workspacePaneHistoryRouteContext({ workspaceId, branchName, worktreePath, route: historyRoute.route })
        : null,
  })
}

function workspacePaneValidRouteTarget(route: ParsedWorkspacePaneRouteTarget): WorkspacePaneRouteTarget {
  if (route?.kind === 'invalid-static') return null
  return route
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

function applyGitWorkspacePaneRouteReconciliation({
  workspaceId,
  branchName,
  reconciliation,
  navigation,
}: {
  workspaceId: WorkspaceId
  branchName: string
  reconciliation: GitWorkspacePaneRouteReconciliation
  navigation: PrimaryWindowNavigationActions
}): void {
  if (reconciliation.kind === 'none' || reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') {
    return
  }
  void commitWorkspacePaneControllerRoute(workspaceId, branchName, null, navigation, { replace: true })
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
  reconciliation: GitWorkspacePaneRouteReconciliation
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
