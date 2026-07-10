import type { ParsedRepoBranchWorkspacePaneRouteTarget, RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
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
  completeWorkspacePaneTabCoordinatorTransition,
  observeWorkspacePaneTabCoordinatorRoute,
  resetWorkspacePaneTabCoordinatorForTest,
  workspacePaneTabCoordinatorReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'

export type WorkspacePaneTabControllerRoute = RepoBranchWorkspacePaneRouteTarget
export type WorkspacePaneTabControllerObservedRoute = ParsedRepoBranchWorkspacePaneRouteTarget
export type WorkspacePaneTabControllerShowNavigation = Pick<
  PrimaryWindowNavigationActions,
  'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
>
export type WorkspacePaneTabControllerCommitNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitRepoBranchWorkspacePaneRoute'
>
export type WorkspacePaneTabControllerNavigation = WorkspacePaneTabControllerShowNavigation &
  WorkspacePaneTabControllerCommitNavigation
type WorkspacePaneTabControllerOptionalShowNavigation = Partial<
  Pick<
    PrimaryWindowNavigationActions,
    'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
  >
>
type MaybePromise<T> = T | Promise<T>

export function beginWorkspacePaneTabControllerTransition(input: {
  repoId: string
  repoRuntimeId?: string
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

export function completeWorkspacePaneTabControllerTransition(transitionId: number | null | undefined): void {
  completeWorkspacePaneTabCoordinatorTransition(transitionId)
}

export function observeWorkspacePaneTabControllerRoute(input: {
  repoId: string
  repoRuntimeId?: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabControllerObservedRoute
}): void {
  observeWorkspacePaneTabCoordinatorRoute(input)
}

export function resetWorkspacePaneTabControllerForTest(): void {
  resetWorkspacePaneTabCoordinatorForTest()
}

export function workspacePaneTabControllerReconciliationDeferred(input: {
  repoId: string
  repoRuntimeId?: string
  branchName: string | null
  worktreePath?: string | null
  route: WorkspacePaneTabControllerObservedRoute
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
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRouteTarget | undefined
}): number | null {
  const branchName = input.target.branchName
  if (!branchName) return null
  const fromRoute =
    workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
    workspacePaneControllerRouteForTab(input.closingTab)
  if (!fromRoute) return null
  const toRoute = input.nextTab ? workspacePaneControllerRouteForTab(input.nextTab) : null
  if (toRoute === undefined) return null
  return beginWorkspacePaneTabControllerTransition({
    repoId: input.target.repoId,
    repoRuntimeId: input.target.repoRuntimeId,
    branchName,
    worktreePath: input.target.worktreePath,
    fromRoute,
    toRoute,
  })
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedRepoBranchWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}

export function selectWorkspacePaneControllerTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  navigation: WorkspacePaneTabControllerShowNavigation,
): boolean {
  const branchName = target.branchName
  if (!branchName) return false
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) return false
  return showWorkspacePaneControllerRoute(target.repoId, branchName, route, navigation)
}

export function commitWorkspacePaneControllerCloseBackTarget(
  target: RepoWorkspaceTabModel,
  nextTab: RepoWorkspaceTab | null,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): MaybePromise<boolean> {
  const branchName = target.branchName
  if (!branchName) return false
  const route = nextTab ? workspacePaneControllerRouteForTab(nextTab) : null
  if (route === undefined) return false
  return commitWorkspacePaneControllerRoute(target.repoId, branchName, route, navigation)
}

export function showWorkspacePaneControllerRoute(
  repoId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerOptionalShowNavigation,
  options?: { replace?: boolean },
): boolean {
  return openResolvedRepoBranchWorkspacePaneRoute(
    {
      openRepoBranch: navigation.showRepoBranchEmptyWorkspacePane ?? (() => false),
      openRepoBranchTab: navigation.showRepoBranchWorkspacePaneTab ?? (() => false),
      openRepoBranchTerminal: navigation.showRepoBranchTerminalSession ?? (() => false),
    },
    repoId,
    branchName,
    route,
    options,
  )
}

export function commitWorkspacePaneControllerRoute(
  repoId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
): MaybePromise<boolean> {
  return navigation.commitRepoBranchWorkspacePaneRoute(repoId, branchName, route, options)
}
