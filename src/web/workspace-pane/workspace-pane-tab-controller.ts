import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  isRepoWorkspaceRuntimeTab,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { WorkspacePaneRouteReconciliation } from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'
import {
  abortWorkspacePaneTabCoordinatorTransition,
  beginWorkspacePaneTabCoordinatorTransition,
  observeWorkspacePaneTabCoordinatorRoute,
  resetWorkspacePaneTabCoordinatorForTest,
  workspacePaneTabCoordinatorReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export type WorkspacePaneTabControllerRoute = RepoBranchWorkspacePaneRoute | null
export type WorkspacePaneTabControllerNavigation = Partial<
  Pick<
    PrimaryWindowNavigationActions,
    'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
  >
>

export function beginWorkspacePaneTabControllerTransition(input: {
  repoId: string
  branchName: string
  worktreePath?: string | null
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
}): number {
  return beginWorkspacePaneTabCoordinatorTransition(input)
}

export function abortWorkspacePaneTabControllerTransition(transitionId: number | null | undefined): void {
  abortWorkspacePaneTabCoordinatorTransition(transitionId)
}

export function observeWorkspacePaneTabControllerRoute(input: {
  repoId: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabControllerRoute
}): void {
  observeWorkspacePaneTabCoordinatorRoute(input)
}

export function resetWorkspacePaneTabControllerForTest(): void {
  resetWorkspacePaneTabCoordinatorForTest()
}

export function workspacePaneTabControllerReconciliationDeferred(input: {
  repoId: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabControllerRoute
  reconciliation: WorkspacePaneRouteReconciliation
}): boolean {
  return workspacePaneTabCoordinatorReconciliationDeferred(input)
}

export function workspacePaneControllerRouteForTab(tab: RepoWorkspaceTab): WorkspacePaneTabControllerRoute | undefined {
  if (isRepoWorkspaceRuntimeTab(tab)) {
    if (tab.runtimeType === 'terminal') return { kind: 'terminal', terminalSessionId: tab.sessionId }
    return undefined
  }
  if (tab.kind === 'static') return { kind: 'static', tab: tab.type }
  return undefined
}

export function beginWorkspacePaneCloseActiveTabTransition(input: {
  target: RepoWorkspaceTabModel
  closingTab: RepoWorkspaceTab
  nextTab: RepoWorkspaceTab | null
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
}): number | null {
  const branchName = input.target.branchName
  if (!branchName) return null
  const fromRoute = input.workspacePaneRoute ?? workspacePaneControllerRouteForTab(input.closingTab)
  if (!fromRoute) return null
  const toRoute = input.nextTab ? workspacePaneControllerRouteForTab(input.nextTab) : null
  if (toRoute === undefined) return null
  return beginWorkspacePaneTabControllerTransition({
    repoId: input.target.repoId,
    branchName,
    worktreePath: input.target.worktreePath,
    fromRoute,
    toRoute,
  })
}

export function selectWorkspacePaneControllerTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  navigation: WorkspacePaneTabControllerNavigation,
): boolean {
  const branchName = target.branchName
  if (!branchName) return false
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) return false
  return showWorkspacePaneControllerRoute(target.repoId, branchName, route, navigation)
}

export function showWorkspacePaneControllerCloseBackTarget(
  target: RepoWorkspaceTabModel,
  nextTab: RepoWorkspaceTab | null,
  navigation: WorkspacePaneTabControllerNavigation,
): boolean {
  const branchName = target.branchName
  if (!branchName) return false
  const route = nextTab ? workspacePaneControllerRouteForTab(nextTab) : null
  if (route === undefined) return false
  return showWorkspacePaneControllerRoute(target.repoId, branchName, route, navigation)
}

export function showWorkspacePaneControllerRoute(
  repoId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerNavigation,
  options?: { replace?: boolean },
): boolean {
  if (route === null) {
    if (!navigation.showRepoBranchEmptyWorkspacePane) return false
    return options
      ? navigation.showRepoBranchEmptyWorkspacePane(repoId, branchName, options)
      : navigation.showRepoBranchEmptyWorkspacePane(repoId, branchName)
  }
  if (route.kind === 'static') {
    if (!navigation.showRepoBranchWorkspacePaneTab) return false
    return options
      ? navigation.showRepoBranchWorkspacePaneTab(repoId, branchName, route.tab, options)
      : navigation.showRepoBranchWorkspacePaneTab(repoId, branchName, route.tab)
  }
  if (route.kind === 'terminal') {
    if (!navigation.showRepoBranchTerminalSession) return false
    return options
      ? navigation.showRepoBranchTerminalSession(repoId, branchName, route.terminalSessionId, options)
      : navigation.showRepoBranchTerminalSession(repoId, branchName, route.terminalSessionId)
  }
  return false
}
