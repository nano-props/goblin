import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  isRepoWorkspaceRuntimeTab,
  type RepoWorkspacePaneModelTarget,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  beginWorkspacePaneRouteIntent,
  workspacePaneActionTargetFromCoordinates,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { openResolvedWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route-navigation.ts'
import {
  commitWorkspacePaneCommittedRuntimeRouteSupplement,
  commitWorkspacePaneRouteSupplement,
} from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  workspacePaneCommittedRuntimeTargetIsCurrent,
  workspacePaneTargetLeaseIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneTabsTargetWorktreePath } from '#/shared/workspace-pane-tabs-target.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

export type WorkspacePaneTabControllerRoute = WorkspacePaneRouteTarget
export interface WorkspacePaneControllerTarget {
  workspaceId: string
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  paneTarget: RepoWorkspacePaneModelTarget
}
export type WorkspacePaneTabControllerObservedRoute = ParsedWorkspacePaneRouteTarget
export type WorkspacePaneTabControllerShowNavigation = Pick<
  PrimaryWindowNavigationActions,
  'showRepoBranchEmptyWorkspacePane' | 'showRepoBranchWorkspacePaneTab' | 'showRepoBranchTerminalSession'
>
export type WorkspacePaneTabControllerCommitNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitWorkspacePaneRoute'
> &
  Pick<PrimaryWindowNavigationActions, 'showRepoWorktreeTerminalSession'> &
  Pick<PrimaryWindowNavigationActions, 'showRepoWorktreeWorkspacePaneTab' | 'showWorkspaceRootPaneTab'>
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
  target: WorkspacePaneControllerTarget
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
  routeIntentId: number | null
}

export function beginWorkspacePaneCloseActiveTabPresentationLease(input: {
  target: RepoWorkspaceTabModel
  closingTab: RepoWorkspaceTab
  nextTab: RepoWorkspaceTab | null
  workspacePaneRoute: ParsedWorkspacePaneRouteTarget | undefined
  presentationToken?: PrimaryWindowPresentationToken
}): WorkspacePaneControllerPresentationLease | null {
  const branchName = input.target.branchName
  if (!branchName) return null
  const fromRoute =
    workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
    workspacePaneControllerRouteForTab(input.closingTab)
  if (!fromRoute) return null
  const toRoute = input.nextTab ? workspacePaneControllerRouteForTab(input.nextTab) : null
  if (toRoute === undefined) return null
  const target: WorkspacePaneControllerTarget = {
    workspaceId: input.target.workspaceId,
    workspaceRuntimeId: input.target.workspaceRuntimeId,
    branchName,
    worktreePath: input.target.worktreePath,
    paneTarget: input.target.paneTarget,
  }
  return {
    presentationToken: input.presentationToken ?? beginPrimaryWindowPresentation(),
    target,
    fromRoute,
    toRoute,
    routeIntentId: beginWorkspacePaneRouteIntent(
      workspacePaneActionTargetFromCoordinates(target),
      workspacePaneRouteKey(fromRoute),
    ),
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
  navigation: WorkspacePaneTabControllerCommitNavigation,
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) return false
  if (target.paneTarget.kind === 'git-worktree' && target.branchName === null) {
    if (!workspacePaneTabControllerTargetIsCurrent(target) || tab.kind === 'pending') return false
    if (isRepoWorkspaceRuntimeTab(tab) && tab.runtimeType === 'terminal') {
      return (
        navigation.showRepoWorktreeTerminalSession?.(
          target.workspaceId,
          target.paneTarget.worktreePath,
          tab.sessionId,
          { presentationToken },
        ) ?? false
      )
    }
    if (tab.kind !== 'static') return false
    return (
      navigation.showRepoWorktreeWorkspacePaneTab?.(target.workspaceId, target.paneTarget.worktreePath, tab.type, {
        presentationToken,
      }) ?? false
    )
  }
  if (target.paneTarget.kind === 'workspace-root') {
    if (!workspacePaneTabControllerTargetIsCurrent(target) || tab.kind === 'pending') return false
    const presentation =
      isRepoWorkspaceRuntimeTab(tab) && tab.runtimeType === 'terminal'
        ? { kind: 'terminal' as const, terminalSessionId: tab.sessionId }
        : tab.kind === 'static'
          ? { kind: 'static' as const, tab: tab.type }
          : null
    return presentation
      ? (navigation.showWorkspaceRootPaneTab?.(target.workspaceId, presentation, { presentationToken }) ?? false)
      : false
  }
  if (target.paneTarget.kind === 'inactive') return false
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) return false
  return await commitWorkspacePaneCurrentTargetRoute(target, route, navigation, undefined, presentationToken)
}

/** Selects canonical tab authority without requiring a live presentation view. */
export async function selectWorkspacePaneControllerTabEntry(
  target: RepoWorkspaceTabModel,
  entry: WorkspacePaneTabEntry,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) return false
  const materialized = target.tabs.find((tab) => tab.identity === workspacePaneTabEntryIdentity(entry))
  if (materialized) return await selectWorkspacePaneControllerTab(target, materialized, navigation, presentationToken)
  if (!isWorkspacePaneRuntimeTabEntry(entry) || entry.type !== 'terminal') return false
  if (!workspacePaneTabControllerTargetIsCurrent(target)) return false
  if (target.paneTarget.kind === 'workspace-root') {
    return (
      navigation.showWorkspaceRootPaneTab?.(
        target.workspaceId,
        { kind: 'terminal', terminalSessionId: entry.runtimeSessionId },
        { presentationToken },
      ) ?? false
    )
  }
  if (target.paneTarget.kind === 'git-worktree' && target.branchName === null) {
    return (
      navigation.showRepoWorktreeTerminalSession?.(
        target.workspaceId,
        target.paneTarget.worktreePath,
        entry.runtimeSessionId,
        { presentationToken },
      ) ?? false
    )
  }
  if (!target.branchName) return false
  return await commitWorkspacePaneCurrentTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: entry.runtimeSessionId },
    navigation,
    undefined,
    presentationToken,
  )
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
  workspaceId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerOptionalShowNavigation,
  options?: { replace?: boolean },
): boolean {
  return openResolvedWorkspacePaneRoute(
    {
      openRepoBranch: navigation.showRepoBranchEmptyWorkspacePane ?? (() => false),
      openRepoBranchTab: navigation.showRepoBranchWorkspacePaneTab ?? (() => false),
      openRepoBranchTerminal: navigation.showRepoBranchTerminalSession ?? (() => false),
    },
    workspaceId,
    branchName,
    route,
    options,
  )
}

export async function commitWorkspacePaneControllerRoute(
  workspaceId: string,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: {
    replace?: boolean
    presentationToken?: PrimaryWindowPresentationToken
    onCommit?: () => void
    routePrecondition?:
      { kind: 'exact-route'; route: WorkspacePaneTabControllerRoute } | { kind: 'current-workspace-target' }
  },
): Promise<boolean> {
  try {
    return await navigation.commitWorkspacePaneRoute(workspaceId, branchName, route, options)
  } catch {
    return false
  }
}

export async function commitWorkspacePaneCurrentTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  return await commitWorkspacePaneValidatedTargetRoute(
    target,
    route,
    navigation,
    workspacePaneTabControllerTargetIsCurrent,
    commitWorkspacePaneRouteSupplement,
    true,
    options,
    presentationToken,
  )
}

export async function commitWorkspacePaneCommittedRuntimeTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options?: { replace?: boolean },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  return await commitWorkspacePaneValidatedTargetRoute(
    target,
    route,
    navigation,
    (candidate) =>
      candidate.branchName !== null &&
      workspacePaneCommittedRuntimeTargetIsCurrent({
        repoId: candidate.workspaceId,
        workspaceRuntimeId: candidate.workspaceRuntimeId,
        branchName: candidate.branchName,
        worktreePath: candidate.worktreePath,
      }),
    commitWorkspacePaneCommittedRuntimeRouteSupplement,
    false,
    options,
    presentationToken,
  )
}

async function commitWorkspacePaneValidatedTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  targetIsCurrent: (target: WorkspacePaneControllerTarget) => boolean,
  commitSupplement: typeof commitWorkspacePaneRouteSupplement,
  useCurrentTargetPrecondition: boolean,
  options: { replace?: boolean } | undefined,
  presentationToken: PrimaryWindowPresentationToken,
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) return false
  const branchName = target.branchName
  if (!branchName || !targetIsCurrent(target)) return false
  let supplementCommitted = false
  const committed = await commitWorkspacePaneControllerRoute(target.workspaceId, branchName, route, navigation, {
    ...options,
    presentationToken,
    ...(useCurrentTargetPrecondition ? { routePrecondition: { kind: 'current-workspace-target' as const } } : {}),
    onCommit: () => {
      supplementCommitted = commitSupplement(
        {
          repoId: target.workspaceId,
          workspaceRuntimeId: target.workspaceRuntimeId,
          branchName,
          worktreePath: target.worktreePath,
        },
        route,
      )
    },
  })
  if (!committed || !supplementCommitted) return false
  return primaryWindowPresentationIsCurrent(presentationToken) && targetIsCurrent(target)
}

export async function commitWorkspacePaneExactTargetRoute(
  target: WorkspacePaneControllerTarget,
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
  const committed = await commitWorkspacePaneControllerRoute(target.workspaceId, branchName, route, navigation, {
    ...options,
    presentationToken,
    routePrecondition: sourceRoute === undefined ? undefined : { kind: 'exact-route', route: sourceRoute },
    onCommit: () => {
      supplementCommitted = commitWorkspacePaneRouteSupplement(
        {
          repoId: target.workspaceId,
          workspaceRuntimeId: target.workspaceRuntimeId,
          branchName,
          worktreePath: target.worktreePath,
        },
        route,
      )
    },
  })
  if (!committed || !supplementCommitted) return false
  return primaryWindowPresentationIsCurrent(presentationToken) && workspacePaneTabControllerTargetIsCurrent(target)
}

export function workspacePaneTabControllerTargetIsCurrent(target: WorkspacePaneControllerTarget): boolean {
  if (target.paneTarget.kind === 'inactive' || target.paneTarget.repoRoot !== target.workspaceId) return false
  if (useWorkspacesStore.getState().workspaces[target.workspaceId]?.workspaceRuntimeId !== target.workspaceRuntimeId)
    return false
  if (target.paneTarget.kind === 'git-branch') {
    return (
      target.branchName === target.paneTarget.branchName &&
      target.worktreePath === null &&
      workspacePaneTargetLeaseIsCurrent({
        repoId: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
        branchName: target.paneTarget.branchName,
        worktreePath: target.worktreePath,
      })
    )
  }
  const targetWorktreePath = workspacePaneTabsTargetWorktreePath(target.paneTarget)
  if (target.paneTarget.kind === 'git-worktree') {
    if (target.worktreePath !== targetWorktreePath) return false
    return target.branchName === null
      ? true
      : workspacePaneTargetLeaseIsCurrent({
          repoId: target.workspaceId,
          workspaceRuntimeId: target.workspaceRuntimeId,
          branchName: target.branchName,
          worktreePath: target.paneTarget.worktreePath,
        })
  }
  return (
    target.branchName === null &&
    target.worktreePath === (parseCanonicalWorkspaceLocator(target.paneTarget.repoRoot)?.path ?? null)
  )
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}
