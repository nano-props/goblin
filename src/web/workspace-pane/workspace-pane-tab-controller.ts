import type {
  BranchWorkspacePaneRouteTarget,
  ParsedBranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRouteTarget,
} from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type {
  FilesystemWorkspacePaneRouteCommitActions,
  WorkspacePaneRouteCommitActions,
} from '#/web/app-navigation-actions.ts'
import {
  isWorkspacePaneRuntimeTab,
  type WorkspacePaneModelTarget,
  type WorkspacePaneTab,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { commitWorkspacePaneRouteSupplement } from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  filesystemWorkspacePaneTargetLeaseForModel,
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  workspacePaneTargetLeaseIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  beginAppNavigation,
  appNavigationIsCurrent,
  type AppNavigationGeneration,
} from '#/web/app-navigation-lifecycle.ts'
import { claimTerminalPresentationFocus, type TerminalPresentationFocusEffects } from '#/web/terminal-focus.ts'

export type WorkspacePaneTabControllerRoute = WorkspacePaneRouteTarget
export interface WorkspacePaneControllerTarget {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  routeTarget: WorkspacePaneModelTarget
  branchName: string | null
  worktreePath: string | null
  paneTarget: WorkspacePaneModelTarget
}
export type WorkspacePaneTabControllerObservedRoute = ParsedWorkspacePaneRouteTarget
type WorkspacePaneControllerRoutePrecondition =
  { kind: 'exact-route'; route: ParsedBranchWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }

export function workspacePaneControllerRouteForTab(tab: WorkspacePaneTab): WorkspacePaneTabControllerRoute | undefined {
  if (isWorkspacePaneRuntimeTab(tab)) {
    if (tab.runtimeType === 'terminal') return { kind: 'terminal', terminalSessionId: tab.sessionId }
    return undefined
  }
  if (tab.kind === 'static') return { kind: 'static', tab: tab.type }
  return undefined
}

export function workspacePaneControllerRouteForEntry(
  entry: WorkspacePaneTabEntry,
): WorkspacePaneTabControllerRoute | undefined {
  if (isWorkspacePaneRuntimeTabEntry(entry)) {
    return entry.type === 'terminal' ? { kind: 'terminal', terminalSessionId: entry.runtimeSessionId } : undefined
  }
  return { kind: 'static', tab: entry.type }
}

export interface WorkspacePaneControllerPresentationLease {
  navigationGeneration: AppNavigationGeneration
  target: WorkspacePaneControllerTarget
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
  focusEffects: TerminalPresentationFocusEffects | null
}

export function beginWorkspacePaneCloseActiveTabPresentationLease(input: {
  target: WorkspacePaneTabModel
  closingEntry: WorkspacePaneTabEntry
  nextEntry: WorkspacePaneTabEntry | null
  workspacePaneRoute: ParsedWorkspacePaneRouteTarget | undefined
  navigationGeneration?: AppNavigationGeneration
}): WorkspacePaneControllerPresentationLease | null {
  const fromRoute =
    workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
    workspacePaneControllerRouteForEntry(input.closingEntry)
  if (!fromRoute) return null
  const toRoute = input.nextEntry ? workspacePaneControllerRouteForEntry(input.nextEntry) : null
  if (toRoute === undefined) return null
  if (!workspacePaneTabControllerTargetIsCurrent(input.target)) return null
  const navigationGeneration = input.navigationGeneration ?? beginAppNavigation()
  const target: WorkspacePaneControllerTarget = {
    workspaceId: input.target.workspaceId,
    workspaceRuntimeId: input.target.workspaceRuntimeId,
    routeTarget: input.target.routeTarget,
    branchName: input.target.branchName,
    worktreePath: input.target.worktreePath,
    paneTarget: input.target.paneTarget,
  }
  return {
    navigationGeneration,
    target,
    fromRoute,
    toRoute,
    focusEffects:
      toRoute?.kind === 'terminal'
        ? claimTerminalPresentationFocus(navigationGeneration, toRoute.terminalSessionId)
        : null,
  }
}

export interface SelectWorkspacePaneControllerTabOptions {
  navigationGeneration?: AppNavigationGeneration
  focusEffects?: TerminalPresentationFocusEffects
}

export async function selectWorkspacePaneControllerTab(
  target: WorkspacePaneTabModel,
  tab: WorkspacePaneTab,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
  options: SelectWorkspacePaneControllerTabOptions = {},
): Promise<boolean> {
  const providedFocusEffects = options.focusEffects
  if (!workspacePaneTabControllerTargetIsCurrent(target) || tab.kind === 'pending') {
    providedFocusEffects?.onAbandon()
    return false
  }
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) {
    providedFocusEffects?.onAbandon()
    return false
  }
  const navigationGeneration = options.navigationGeneration ?? beginAppNavigation()
  if (!appNavigationIsCurrent(navigationGeneration)) {
    providedFocusEffects?.onAbandon()
    return false
  }
  const focusEffects =
    isWorkspacePaneRuntimeTab(tab) && tab.runtimeType === 'terminal'
      ? (providedFocusEffects ?? claimTerminalPresentationFocus(navigationGeneration, tab.sessionId))
      : null
  return await commitWorkspacePaneControllerTargetRoute(
    target,
    route,
    navigation,
    focusEffects ?? undefined,
    navigationGeneration,
  )
}

/** Selects canonical tab authority without requiring a live presentation view. */
export async function selectWorkspacePaneControllerTabEntry(
  target: WorkspacePaneTabModel,
  entry: WorkspacePaneTabEntry,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
  navigationGeneration?: AppNavigationGeneration,
): Promise<boolean> {
  const materialized = target.tabs.find((tab) => tab.identity === workspacePaneTabEntryIdentity(entry))
  if (materialized) {
    return await selectWorkspacePaneControllerTab(target, materialized, navigation, { navigationGeneration })
  }
  if (!isWorkspacePaneRuntimeTabEntry(entry) || entry.type !== 'terminal') return false
  if (!workspacePaneTabControllerTargetIsCurrent(target)) return false
  const admittedNavigationGeneration = navigationGeneration ?? beginAppNavigation()
  if (!appNavigationIsCurrent(admittedNavigationGeneration)) return false
  const focusEffects = claimTerminalPresentationFocus(admittedNavigationGeneration, entry.runtimeSessionId)
  return await commitWorkspacePaneControllerTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: entry.runtimeSessionId },
    navigation,
    focusEffects ?? undefined,
    admittedNavigationGeneration,
  )
}

export function commitWorkspacePaneControllerCloseBackTarget(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
): Promise<boolean> {
  return commitWorkspacePaneControllerTargetRoute(
    lease.target,
    lease.toRoute,
    navigation,
    lease.focusEffects ?? undefined,
    lease.navigationGeneration,
    lease.fromRoute,
  )
}

export function commitWorkspacePaneControllerRetirementCloseBackTarget(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
): Promise<boolean> {
  return commitWorkspacePaneControllerTargetRoute(
    lease.target,
    lease.toRoute,
    navigation,
    { replace: true, ...(lease.focusEffects ?? {}) },
    lease.navigationGeneration,
    lease.fromRoute,
  )
}

async function commitWorkspacePaneControllerTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: FilesystemWorkspacePaneRouteCommitActions,
  options: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void } | undefined,
  navigationGeneration: AppNavigationGeneration,
  fromRoute?: WorkspacePaneTabControllerObservedRoute,
): Promise<boolean> {
  if (target.routeTarget.kind === 'inactive') {
    options?.onAbandon?.()
    return false
  }
  if (target.routeTarget.kind === 'git-branch') {
    if (route?.kind === 'terminal' || fromRoute?.kind === 'terminal') {
      options?.onAbandon?.()
      return false
    }
    return fromRoute === undefined
      ? await commitWorkspacePaneCurrentTargetRoute(target, route, navigation, options, navigationGeneration)
      : await commitWorkspacePaneExactTargetRoute(target, fromRoute, route, navigation, options, navigationGeneration)
  }
  if (!appNavigationIsCurrent(navigationGeneration)) {
    options?.onAbandon?.()
    return false
  }
  const lease = filesystemWorkspacePaneTargetLeaseForModel(target)
  if (!lease || !filesystemWorkspacePaneTargetLeaseIsCurrent(lease)) {
    options?.onAbandon?.()
    return false
  }
  return await navigation.commitFilesystemWorkspacePaneRoute(lease, route, {
    replace: options?.replace,
    navigationGeneration,
    onCommit: options?.onCommit,
    onAbandon: options?.onAbandon,
    routePrecondition: fromRoute === undefined ? undefined : { kind: 'exact-route', route: fromRoute },
  })
}

export async function commitWorkspacePaneControllerRoute(
  workspaceId: WorkspaceId,
  branchName: string,
  route: BranchWorkspacePaneRouteTarget,
  navigation: WorkspacePaneRouteCommitActions,
  options?: {
    replace?: boolean
    navigationGeneration?: AppNavigationGeneration
    routePrecondition?:
      { kind: 'exact-route'; route: ParsedBranchWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
  },
): Promise<boolean> {
  return await navigation.commitWorkspacePaneRoute(workspaceId, branchName, route, {
    replace: options?.replace,
    navigationGeneration: options?.navigationGeneration,
    routePrecondition: options?.routePrecondition,
  })
}

export async function commitWorkspacePaneCurrentTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: BranchWorkspacePaneRouteTarget,
  navigation: WorkspacePaneRouteCommitActions,
  options?: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void },
  navigationGeneration?: AppNavigationGeneration,
): Promise<boolean> {
  if (!target.branchName || !workspacePaneTabControllerTargetIsCurrent(target)) {
    options?.onAbandon?.()
    return false
  }
  return await commitWorkspacePaneValidatedTargetRoute(
    target,
    route,
    navigation,
    workspacePaneTabControllerTargetIsCurrent,
    commitWorkspacePaneRouteSupplement,
    { routePrecondition: { kind: 'current-workspace-target' } },
    options,
    navigationGeneration ?? beginAppNavigation(),
  )
}

async function commitWorkspacePaneValidatedTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: BranchWorkspacePaneRouteTarget,
  navigation: WorkspacePaneRouteCommitActions,
  targetIsCurrent: (target: WorkspacePaneControllerTarget) => boolean,
  commitSupplement: typeof commitWorkspacePaneRouteSupplement,
  routeOptions: { routePrecondition?: WorkspacePaneControllerRoutePrecondition | undefined },
  options: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void } | undefined,
  navigationGeneration: AppNavigationGeneration,
): Promise<boolean> {
  if (!appNavigationIsCurrent(navigationGeneration)) {
    options?.onAbandon?.()
    return false
  }
  const branchName = target.branchName
  if (!branchName || !targetIsCurrent(target)) {
    options?.onAbandon?.()
    return false
  }
  let completed = false
  try {
    const committed = await commitWorkspacePaneControllerRoute(target.workspaceId, branchName, route, navigation, {
      replace: options?.replace,
      navigationGeneration,
      ...routeOptions,
    })
    const supplementCommitted =
      committed &&
      commitSupplement(
        {
          workspaceRuntimeId: target.workspaceRuntimeId,
          routeTarget: { kind: 'git-branch', workspaceId: target.workspaceId, branchName },
        },
        route,
      )
    completed =
      committed && supplementCommitted && appNavigationIsCurrent(navigationGeneration) && targetIsCurrent(target)
  } catch (error) {
    options?.onAbandon?.()
    throw error
  }
  if (!completed) {
    options?.onAbandon?.()
    return false
  }
  options?.onCommit?.()
  return true
}

export async function commitWorkspacePaneExactTargetRoute(
  target: WorkspacePaneControllerTarget,
  fromRoute: ParsedBranchWorkspacePaneRouteTarget | undefined,
  route: BranchWorkspacePaneRouteTarget,
  navigation: WorkspacePaneRouteCommitActions,
  options?: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void },
  navigationGeneration?: AppNavigationGeneration,
): Promise<boolean> {
  if (!target.branchName || !workspacePaneTabControllerTargetIsCurrent(target)) {
    options?.onAbandon?.()
    return false
  }
  return await commitWorkspacePaneValidatedTargetRoute(
    target,
    route,
    navigation,
    workspacePaneTabControllerTargetIsCurrent,
    commitWorkspacePaneRouteSupplement,
    { routePrecondition: fromRoute === undefined ? undefined : { kind: 'exact-route', route: fromRoute } },
    options,
    navigationGeneration ?? beginAppNavigation(),
  )
}

export function workspacePaneTabControllerTargetIsCurrent(target: WorkspacePaneControllerTarget): boolean {
  if (
    target.routeTarget.kind === 'inactive' ||
    target.paneTarget.kind === 'inactive' ||
    target.routeTarget.workspaceId !== target.workspaceId ||
    target.paneTarget.workspaceId !== target.workspaceId
  ) {
    return false
  }
  if (target.routeTarget.kind !== 'git-branch') {
    const lease = filesystemWorkspacePaneTargetLeaseForModel(target)
    return lease !== null && filesystemWorkspacePaneTargetLeaseIsCurrent(lease)
  }
  if (
    target.paneTarget.kind !== 'git-branch' ||
    target.branchName !== target.routeTarget.branchName ||
    target.paneTarget.branchName !== target.routeTarget.branchName ||
    target.worktreePath !== null
  ) {
    return false
  }
  return workspacePaneTargetLeaseIsCurrent({
    workspaceRuntimeId: target.workspaceRuntimeId,
    routeTarget: target.routeTarget,
  })
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}
