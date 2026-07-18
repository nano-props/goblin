import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { usePrimaryWindowNavigation, type PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useSyncRepoWorkspaceRuntimeTabSelection } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'
import {
  commitWorkspacePaneControllerRoute,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  subscribeWorkspacePaneRouteIntents,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { workspacePaneRouteKey } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'

export interface WorkspacePaneRouteControllerInput {
  enabled?: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  model: RepoWorkspaceTabModel
}

// Single side-effect boundary for URL-backed workspace-pane routes.
// Data flows from server/projection model -> route reconciliation -> app
// history -> validated preference sync -> canonical route replacement.
// Keep this ordering intact so browser Back/Forward metadata is consumed
// before a stale URL is replaced.
export function useWorkspacePaneRouteController({
  enabled = true,
  repoId,
  branchName,
  worktreePath,
  route,
  model,
}: WorkspacePaneRouteControllerInput): WorkspacePaneRouteReconciliation {
  const navigation = usePrimaryWindowNavigation()
  const reconciliation = useMemo(
    () => (enabled ? reconcileWorkspacePaneRoute(route, model) : { kind: 'none' as const }),
    [enabled, route, model],
  )
  const routeIntentPending = useSyncExternalStore(
    subscribeWorkspacePaneRouteIntents,
    () =>
      route?.kind !== 'invalid-static' &&
      workspacePaneRouteIntentPending(
        workspacePaneActionTargetFromCoordinates({
          repoId,
          workspaceRuntimeId: model.workspaceRuntimeId,
          branchName,
          worktreePath,
        }),
        workspacePaneRouteKey(route),
      ),
    () => false,
  )
  const effectiveReconciliation =
    routeIntentPending && reconciliation.kind === 'replace-empty-pane'
      ? ({ kind: 'pending' } as const)
      : reconciliation

  useWorkspacePaneNavigationHistory({
    enabled,
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation: effectiveReconciliation,
  })
  useSyncRoutedWorkspacePaneSelection({
    enabled,
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncRepoWorkspaceRuntimeTabSelection(model, { enabled: enabled && reconciliation.kind === 'none' })
  useReconcileWorkspacePaneRoute({
    enabled,
    repoId,
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
  repoId,
  workspaceRuntimeId,
  branchName,
  worktreePath,
  route,
  reconciliation,
  routeIntentPending,
  navigation,
}: {
  enabled: boolean
  repoId: string
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
  routeIntentPending: boolean
  navigation: PrimaryWindowNavigationActions
}): void {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates({ repoId, workspaceRuntimeId, branchName, worktreePath }),
      () => {
        if (cancelled) return
        if (!branchName) return
        if (routeIntentPending && reconciliation.kind === 'replace-empty-pane') return
        applyWorkspacePaneRouteReconciliation({ repoId, branchName, reconciliation, navigation })
      },
    )
    return () => {
      cancelled = true
    }
  }, [branchName, enabled, navigation, reconciliation, repoId, workspaceRuntimeId, routeIntentPending, worktreePath])
}

function useWorkspacePaneNavigationHistory({
  enabled,
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const historyRoute = workspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  const replaceCurrentRoute = workspacePaneValidRouteTarget(route)
  const replaceCurrentRouteContext =
    branchName && reconciliation.kind === 'replace-empty-pane'
      ? workspacePaneHistoryRouteContext({
          repoId,
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
        ? workspacePaneHistoryRouteContext({ repoId, branchName, worktreePath, route: historyRoute.route })
        : null,
  })
}

function workspacePaneValidRouteTarget(
  route: ParsedWorkspacePaneRouteTarget,
): WorkspacePaneRouteTarget {
  if (route?.kind === 'invalid-static') return null
  return route
}

function workspacePaneHistoryRouteContext({
  repoId,
  branchName,
  worktreePath,
  route,
}: {
  repoId: string
  branchName: string
  worktreePath: string | null
  route: WorkspacePaneRouteTarget
}): WorkspaceNavigationRouteContext {
  return {
    kind: 'branch',
    repoId,
    branchName,
    worktreePath,
    workspacePaneRoute: route,
  }
}

function applyWorkspacePaneRouteReconciliation({
  repoId,
  branchName,
  reconciliation,
  navigation,
}: {
  repoId: string
  branchName: string
  reconciliation: WorkspacePaneRouteReconciliation
  navigation: PrimaryWindowNavigationActions
}): void {
  if (reconciliation.kind === 'none' || reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') {
    return
  }
  void commitWorkspacePaneControllerRoute(repoId, branchName, null, navigation, { replace: true })
}

function useSyncRoutedWorkspacePaneSelection({
  enabled,
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  enabled: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: ParsedWorkspacePaneRouteTarget
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const setWorkspacePaneTab = useReposStore((s) => s.setWorkspacePaneTab)
  useEffect(() => {
    if (!enabled) return
    if (!branchName) return
    if (reconciliation.kind !== 'none') return
    const state = useReposStore.getState()
    const repo = state.repos[repoId]
    if (!repo) return
    const target = requiredGitWorkspacePaneTabsTarget(repoId, branchName, worktreePath)
    if (route?.kind === 'invalid-static') return
    const routeTab = route === null ? null : route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(repoId, branchName, routeTab)
    }
  }, [branchName, enabled, reconciliation.kind, repoId, route, setWorkspacePaneTab, worktreePath])
}
