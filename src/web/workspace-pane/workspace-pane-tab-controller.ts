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
  leaveWorkspacePaneTabCoordinatorTarget,
  observeWorkspacePaneTabCoordinatorRoute,
  resetWorkspacePaneTabCoordinatorForTest,
  waitForWorkspacePaneTabCoordinatorTransition,
  workspacePaneTabCoordinatorObservedRoute,
  workspacePaneTabCoordinatorReconciliationDeferred,
  workspacePaneTabCoordinatorTargetIsCurrent,
  type WorkspacePaneTabCoordinatorTarget,
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
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
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
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  route: WorkspacePaneTabControllerObservedRoute
}): void {
  observeWorkspacePaneTabCoordinatorRoute(input)
}

export function leaveWorkspacePaneTabControllerTarget(target: WorkspacePaneTabCoordinatorTarget): void {
  leaveWorkspacePaneTabCoordinatorTarget(target)
}

export function resetWorkspacePaneTabControllerForTest(): void {
  resetWorkspacePaneTabCoordinatorForTest()
}

export function workspacePaneTabControllerReconciliationDeferred(input: {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
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

export interface WorkspacePaneControllerPresentationLease {
  transitionId: number
  target: WorkspacePaneTabCoordinatorTarget
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
}

export function beginWorkspacePaneCloseActiveTabPresentationLease(input: {
  target: RepoWorkspaceTabModel
  closingTab: RepoWorkspaceTab
  nextTab: RepoWorkspaceTab | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRouteTarget | undefined
}): WorkspacePaneControllerPresentationLease | null {
  const branchName = input.target.branchName
  if (!branchName) return null
  const fromRoute =
    workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
    workspacePaneControllerRouteForTab(input.closingTab)
  if (!fromRoute) return null
  const toRoute = input.nextTab ? workspacePaneControllerRouteForTab(input.nextTab) : null
  if (toRoute === undefined) return null
  const target = {
    repoId: input.target.repoId,
    repoRuntimeId: input.target.repoRuntimeId,
    branchName,
    worktreePath: input.target.worktreePath,
  }
  const transitionId = beginWorkspacePaneTabControllerTransition({
    ...target,
    fromRoute,
    toRoute,
  })
  return { transitionId, target, fromRoute, toRoute }
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedRepoBranchWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}

export async function selectWorkspacePaneControllerTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): Promise<boolean> {
  const branchName = target.branchName
  if (!branchName) return false
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) return false
  return await commitWorkspacePaneCurrentTargetRoute(target, fromRoute, route, navigation)
}

export function commitWorkspacePaneControllerCloseBackTarget(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): Promise<boolean> {
  return commitWorkspacePaneControllerPresentationLease(lease, navigation)
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

export async function commitWorkspacePaneCurrentTargetRoute(
  target: WorkspacePaneTabCoordinatorTarget,
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
): Promise<boolean> {
  const branchName = target.branchName
  if (!branchName) return false
  const observedRoute = workspacePaneTabCoordinatorObservedRoute(target) ?? fromRoute
  if (!workspacePaneTabCoordinatorTargetIsCurrent(target)) return false
  if (
    fromRoute !== undefined &&
    observedRoute !== undefined &&
    !workspacePaneTabControllerRoutesEqual(observedRoute, fromRoute)
  ) {
    return false
  }
  if (
    workspacePaneTabCoordinatorTargetIsCurrent(target) &&
    observedRoute !== undefined &&
    workspacePaneTabControllerRoutesEqual(observedRoute, route)
  ) {
    return true
  }
  const sourceRoute = workspacePaneTabControllerRouteFromParsed(observedRoute)
  if (sourceRoute === undefined) return false
  const lease: WorkspacePaneControllerPresentationLease = {
    transitionId: beginWorkspacePaneTabControllerTransition({
      ...target,
      branchName,
      fromRoute: sourceRoute,
      toRoute: route,
    }),
    target,
    fromRoute: sourceRoute,
    toRoute: route,
  }
  return await commitWorkspacePaneControllerPresentationLease(lease, navigation, options)
}

export async function commitWorkspacePaneControllerPresentationLease(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
): Promise<boolean> {
  const branchName = lease.target.branchName
  const observedRoute = workspacePaneTabCoordinatorObservedRoute(lease.target)
  const validLease =
    !!branchName &&
    observedRoute !== undefined &&
    workspacePaneTabControllerRoutesEqual(observedRoute, lease.fromRoute) &&
    workspacePaneTabCoordinatorTargetIsCurrent(lease.target)
  if (!validLease) {
    abortWorkspacePaneTabControllerTransition(lease.transitionId)
    return false
  }
  let accepted = false
  try {
    accepted = await commitWorkspacePaneControllerRoute(
      lease.target.repoId,
      branchName,
      lease.toRoute,
      navigation,
      options,
    )
  } catch {
    abortWorkspacePaneTabControllerTransition(lease.transitionId)
    return false
  }
  if (!accepted) {
    abortWorkspacePaneTabControllerTransition(lease.transitionId)
    return false
  }
  return await waitForWorkspacePaneTabCoordinatorTransition(lease.transitionId)
}

export function workspacePaneTabControllerTargetIsCurrent(target: WorkspacePaneTabCoordinatorTarget): boolean {
  return workspacePaneTabCoordinatorTargetIsCurrent(target)
}

function workspacePaneTabControllerRoutesEqual(
  a: WorkspacePaneTabControllerObservedRoute,
  b: WorkspacePaneTabControllerObservedRoute,
): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'static') return b.kind === 'static' && a.tab === b.tab
  if (a.kind === 'terminal') return b.kind === 'terminal' && a.terminalSessionId === b.terminalSessionId
  return b.kind === 'invalid-static' && a.tabKey === b.tabKey
}
