import { useEffect, useMemo } from 'react'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import {
  useWorkspaceNavigationHistory,
  type WorkspaceNavigationRouteContext,
} from '#/web/workspace-navigation-history.ts'
import { usePrimaryWindowNavigation, type PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { useSyncRepoWorkspaceRuntimeTabSelection } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'

export interface WorkspacePaneRouteControllerInput {
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
  repoId,
  branchName,
  worktreePath,
  route,
  model,
}: WorkspacePaneRouteControllerInput): WorkspacePaneRouteReconciliation {
  const navigation = usePrimaryWindowNavigation()
  const reconciliation = useMemo(() => reconcileWorkspacePaneRoute(route, model), [route, model])

  useWorkspacePaneNavigationHistory({
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncRoutedWorkspacePaneSelection({
    repoId,
    branchName,
    worktreePath,
    route,
    reconciliation,
  })
  useSyncRepoWorkspaceRuntimeTabSelection(model, { enabled: reconciliation.kind === 'none' })
  useReconcileWorkspacePaneRoute({
    repoId,
    branchName,
    reconciliation,
    navigation,
  })

  return reconciliation
}

function useReconcileWorkspacePaneRoute({
  repoId,
  branchName,
  reconciliation,
  navigation,
}: {
  repoId: string
  branchName: string | null
  reconciliation: WorkspacePaneRouteReconciliation
  navigation: Pick<PrimaryWindowNavigationActions, 'selectRepoBranch'>
}): void {
  useEffect(() => {
    if (!branchName) return
    applyWorkspacePaneRouteReconciliation({ repoId, branchName, reconciliation, navigation })
  }, [branchName, navigation, reconciliation, repoId])
}

function useWorkspacePaneNavigationHistory({
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
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
      branchName && historyRoute.kind === 'record'
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
  navigation: Pick<PrimaryWindowNavigationActions, 'selectRepoBranch'>
}): void {
  if (reconciliation.kind === 'none' || reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') {
    return
  }
  navigation.selectRepoBranch(repoId, branchName, { replace: true })
}

function useSyncRoutedWorkspacePaneSelection({
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const setWorkspacePaneTab = useReposStore((s) => s.setWorkspacePaneTab)
  useEffect(() => {
    if (!branchName || !route) return
    if (reconciliation.kind !== 'none') return
    const state = useReposStore.getState()
    const repo = state.repos[repoId]
    if (!repo) return
    const target = {
      repoRoot: repoId,
      branchName,
      worktreePath,
    }
    if (route.kind === 'invalid-static') return
    const routeTab = route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(repoId, branchName, routeTab)
    }
  }, [branchName, reconciliation.kind, repoId, route, setWorkspacePaneTab, worktreePath])
}
