import type { ParsedRepoBranchWorkspacePaneRouteTarget, RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  isRepoWorkspaceRuntimeTab,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  beginWorkspacePaneRouteIntent,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { openResolvedRepoBranchWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import { workspacePaneTargetLeaseIsCurrent } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

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
type WorkspacePaneTabControllerOptionalShowNavigation = Partial<WorkspacePaneTabControllerShowNavigation>

export function workspacePaneControllerRouteForTab(tab: RepoWorkspaceTab): WorkspacePaneTabControllerRoute | undefined {
  if (isRepoWorkspaceRuntimeTab(tab)) {
    if (tab.runtimeType === 'terminal') return { kind: 'terminal', terminalSessionId: tab.sessionId }
    return undefined
  }
  if (tab.kind === 'static') return { kind: 'static', tab: tab.type }
  return undefined
}

export interface WorkspacePaneControllerPresentationLease {
  presentationToken: PrimaryWindowPresentationToken
  target: WorkspacePaneActionTarget
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
  routeIntentId: number | null
}

export function beginWorkspacePaneCloseActiveTabPresentationLease(input: {
  target: RepoWorkspaceTabModel
  closingTab: RepoWorkspaceTab
  nextTab: RepoWorkspaceTab | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRouteTarget | undefined
  presentationToken?: PrimaryWindowPresentationToken
}): WorkspacePaneControllerPresentationLease | null {
  const branchName = input.target.branchName
  if (!branchName) return null
  const fromRoute = workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
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
  return {
    presentationToken: input.presentationToken ?? beginPrimaryWindowPresentation(),
    target,
    fromRoute,
    toRoute,
    routeIntentId: beginWorkspacePaneRouteIntent(target, workspacePaneRouteKey(fromRoute)),
  }
}

export function workspacePaneRouteKey(route: WorkspacePaneTabControllerRoute): string {
  if (route === null) return 'empty'
  if (route.kind === 'static') return `static:${route.tab}`
  return `terminal:${route.terminalSessionId}`
}

export async function selectWorkspacePaneControllerTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) return false
  return await commitWorkspacePaneExactTargetRoute(target, fromRoute, route, navigation, undefined, presentationToken)
}

export function commitWorkspacePaneControllerCloseBackTarget(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): Promise<boolean> {
  return commitWorkspacePaneExactTargetRoute(
    lease.target,
    lease.fromRoute,
    lease.toRoute,
    navigation,
    undefined,
    lease.presentationToken,
  )
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

export async function commitWorkspacePaneControllerRoute(
  repoId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: {
    replace?: boolean
    presentationToken?: PrimaryWindowPresentationToken
    onCommit?: () => void
    expectedCurrentRoute?: WorkspacePaneTabControllerRoute
  },
): Promise<boolean> {
  try {
    return await navigation.commitRepoBranchWorkspacePaneRoute(repoId, branchName, route, options)
  } catch {
    return false
  }
}

export async function commitWorkspacePaneCurrentTargetRoute(
  target: WorkspacePaneActionTarget,
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  return await commitWorkspacePaneExactTargetRoute(target, fromRoute, route, navigation, options, presentationToken)
}

export async function commitWorkspacePaneExactTargetRoute(
  target: WorkspacePaneActionTarget,
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) return false
  const branchName = target.branchName
  if (!branchName) return false
  if (!workspacePaneTabControllerTargetIsCurrent(target)) return false
  const sourceRoute = workspacePaneTabControllerRouteFromParsed(fromRoute)
  if (fromRoute !== undefined && sourceRoute === undefined) return false
  let supplementCommitted = false
  const committed = await commitWorkspacePaneControllerRoute(target.repoId, branchName, route, navigation, {
    ...options,
    presentationToken,
    expectedCurrentRoute: sourceRoute,
    onCommit: () => {
      supplementCommitted = commitWorkspacePaneRouteSupplement({ ...target, branchName }, route)
    },
  })
  if (!committed || !supplementCommitted) return false
  return primaryWindowPresentationIsCurrent(presentationToken) && workspacePaneTabControllerTargetIsCurrent(target)
}

export function workspacePaneTabControllerTargetIsCurrent(target: WorkspacePaneActionTarget): boolean {
  return target.branchName !== null && workspacePaneTargetLeaseIsCurrent({ ...target, branchName: target.branchName })
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedRepoBranchWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}
