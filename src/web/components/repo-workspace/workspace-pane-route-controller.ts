import { useEffect, useMemo } from 'react'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { usePrimaryWindowNavigation, type PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { useSyncRepoWorkspaceRuntimeTabSelection } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'
import {
  observeWorkspacePaneTabControllerRoute,
  showWorkspacePaneControllerRoute,
  workspacePaneTabControllerReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export interface WorkspacePaneRouteControllerInput {
  enabled?: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null
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
  const historyReconciliation = workspacePaneRouteControllerHistoryReconciliation({
    enabled,
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })

  useWorkspacePaneNavigationHistory({
    enabled,
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation: historyReconciliation,
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
    branchName,
    worktreePath,
    route,
    reconciliation,
    navigation,
  })

  return reconciliation
}

function workspacePaneRouteControllerHistoryReconciliation(input: {
  enabled: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null
  reconciliation: WorkspacePaneRouteReconciliation
}): WorkspacePaneRouteReconciliation {
  if (!input.enabled) return input.reconciliation
  if (
    workspacePaneTabControllerReconciliationDeferred({
      repoId: input.repoId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      route: input.route,
      reconciliation: input.reconciliation,
    })
  ) {
    return { kind: 'pending' }
  }
  return input.reconciliation
}

function useReconcileWorkspacePaneRoute({
  enabled,
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
  navigation,
}: {
  enabled: boolean
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null
  reconciliation: WorkspacePaneRouteReconciliation
  navigation: PrimaryWindowNavigationActions
}): void {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void runWorkspacePaneTabCoordinatorTask({ repoId, branchName, worktreePath }, () => {
      if (cancelled) return
      observeWorkspacePaneTabControllerRoute({ repoId, branchName, worktreePath, route })
      if (!branchName) return
      if (workspacePaneTabControllerReconciliationDeferred({ repoId, branchName, worktreePath, route, reconciliation })) {
        return
      }
      applyWorkspacePaneRouteReconciliation({ repoId, branchName, reconciliation, navigation })
    })
    return () => {
      cancelled = true
    }
  }, [branchName, enabled, navigation, reconciliation, repoId, route, worktreePath])
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
  route: RepoBranchWorkspacePaneRoute | null
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const historyRoute = workspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  const replaceCurrentRouteContext =
    branchName && reconciliation.kind === 'replace-empty-pane'
      ? workspacePaneHistoryRouteContext({
          repoId,
          branchName,
          worktreePath,
          route: route ?? null,
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

function workspacePaneHistoryRouteContext({
  repoId,
  branchName,
  worktreePath,
  route,
}: {
  repoId: string
  branchName: string
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null
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
  showWorkspacePaneControllerRoute(repoId, branchName, null, navigation, { replace: true })
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
  route: RepoBranchWorkspacePaneRoute | null
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
    const target = {
      repoRoot: repoId,
      branchName,
      worktreePath,
    }
    if (route?.kind === 'invalid-static') return
    const routeTab = route === null ? null : route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(repoId, branchName, routeTab)
    }
  }, [branchName, enabled, reconciliation.kind, repoId, route, setWorkspacePaneTab, worktreePath])
}
