import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  isWorkspacePaneRuntimeTab,
  type WorkspacePaneModelTarget,
  type WorkspacePaneTab,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  beginWorkspacePaneRouteIntent,
  workspacePaneActionTargetFromCoordinates,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  commitWorkspacePaneCommittedRuntimeRouteSupplement,
  commitWorkspacePaneRouteSupplement,
} from '#/web/workspace-pane/workspace-pane-route-supplement.ts'
import {
  filesystemWorkspacePaneTargetLeaseForModel,
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  workspacePaneCommittedRuntimeTargetIsCurrent,
  workspacePaneTargetLeaseIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
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
export type WorkspacePaneTabControllerCommitNavigation = Pick<
  PrimaryWindowNavigationActions,
  'commitWorkspacePaneRoute' | 'commitFilesystemWorkspacePaneRoute'
>
export type WorkspacePaneRouteCommitNavigation = Pick<PrimaryWindowNavigationActions, 'commitWorkspacePaneRoute'>

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
  presentationToken: PrimaryWindowPresentationToken
  target: WorkspacePaneControllerTarget
  fromRoute: WorkspacePaneTabControllerRoute
  toRoute: WorkspacePaneTabControllerRoute
  routeIntentId: number | null
  focusEffects: TerminalPresentationFocusEffects | null
}

export function beginWorkspacePaneCloseActiveTabPresentationLease(input: {
  target: WorkspacePaneTabModel
  closingEntry: WorkspacePaneTabEntry
  nextEntry: WorkspacePaneTabEntry | null
  workspacePaneRoute: ParsedWorkspacePaneRouteTarget | undefined
  presentationToken?: PrimaryWindowPresentationToken
}): WorkspacePaneControllerPresentationLease | null {
  const fromRoute =
    workspacePaneTabControllerRouteFromParsed(input.workspacePaneRoute) ??
    workspacePaneControllerRouteForEntry(input.closingEntry)
  if (!fromRoute) return null
  const toRoute = input.nextEntry ? workspacePaneControllerRouteForEntry(input.nextEntry) : null
  if (toRoute === undefined) return null
  if (input.target.routeTarget.kind === 'inactive') return null
  const presentationToken = input.presentationToken ?? beginPrimaryWindowPresentation()
  const target: WorkspacePaneControllerTarget = {
    workspaceId: input.target.workspaceId,
    workspaceRuntimeId: input.target.workspaceRuntimeId,
    routeTarget: input.target.routeTarget,
    branchName: input.target.branchName,
    worktreePath: input.target.worktreePath,
    paneTarget: input.target.paneTarget,
  }
  return {
    presentationToken,
    target,
    fromRoute,
    toRoute,
    routeIntentId: beginWorkspacePaneRouteIntent(
      workspacePaneActionTargetFromCoordinates(target),
      workspacePaneRouteKey(fromRoute),
    ),
    focusEffects:
      toRoute?.kind === 'terminal'
        ? claimTerminalPresentationFocus(presentationToken, toRoute.terminalSessionId)
        : null,
  }
}

export function workspacePaneRouteKey(route: WorkspacePaneTabControllerRoute): string {
  if (route === null) return 'empty'
  if (route.kind === 'static') return `static:${route.tab}`
  return `terminal:${route.terminalSessionId}`
}

export interface SelectWorkspacePaneControllerTabOptions {
  presentationToken?: PrimaryWindowPresentationToken
  focusEffects?: TerminalPresentationFocusEffects
}

export async function selectWorkspacePaneControllerTab(
  target: WorkspacePaneTabModel,
  tab: WorkspacePaneTab,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options: SelectWorkspacePaneControllerTabOptions = {},
): Promise<boolean> {
  const presentationToken = options.presentationToken ?? beginPrimaryWindowPresentation()
  const providedFocusEffects = options.focusEffects
  if (!primaryWindowPresentationIsCurrent(presentationToken)) {
    providedFocusEffects?.onAbandon()
    return false
  }
  const focusEffects =
    isWorkspacePaneRuntimeTab(tab) && tab.runtimeType === 'terminal'
      ? (providedFocusEffects ?? claimTerminalPresentationFocus(presentationToken, tab.sessionId))
      : null
  if (!workspacePaneTabControllerTargetIsCurrent(target) || tab.kind === 'pending') {
    focusEffects?.onAbandon()
    return false
  }
  const route = workspacePaneControllerRouteForTab(tab)
  if (route === undefined) {
    focusEffects?.onAbandon()
    return false
  }
  return await commitWorkspacePaneControllerTargetRoute(
    target,
    route,
    navigation,
    focusEffects ?? undefined,
    presentationToken,
  )
}

/** Selects canonical tab authority without requiring a live presentation view. */
export async function selectWorkspacePaneControllerTabEntry(
  target: WorkspacePaneTabModel,
  entry: WorkspacePaneTabEntry,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) return false
  const materialized = target.tabs.find((tab) => tab.identity === workspacePaneTabEntryIdentity(entry))
  if (materialized) {
    return await selectWorkspacePaneControllerTab(target, materialized, navigation, { presentationToken })
  }
  if (!isWorkspacePaneRuntimeTabEntry(entry) || entry.type !== 'terminal') return false
  const focusEffects = claimTerminalPresentationFocus(presentationToken, entry.runtimeSessionId)
  if (!workspacePaneTabControllerTargetIsCurrent(target)) {
    focusEffects?.onAbandon()
    return false
  }
  return await commitWorkspacePaneControllerTargetRoute(
    target,
    { kind: 'terminal', terminalSessionId: entry.runtimeSessionId },
    navigation,
    focusEffects ?? undefined,
    presentationToken,
  )
}

export function commitWorkspacePaneControllerCloseBackTarget(
  lease: WorkspacePaneControllerPresentationLease,
  navigation: WorkspacePaneTabControllerCommitNavigation,
): Promise<boolean> {
  return commitWorkspacePaneControllerTargetRoute(
    lease.target,
    lease.toRoute,
    navigation,
    lease.focusEffects ?? undefined,
    lease.presentationToken,
    lease.fromRoute,
  )
}

async function commitWorkspacePaneControllerTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneTabControllerCommitNavigation,
  options: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void } | undefined,
  presentationToken: PrimaryWindowPresentationToken,
  fromRoute?: WorkspacePaneTabControllerObservedRoute,
): Promise<boolean> {
  if (target.routeTarget.kind === 'inactive') {
    options?.onAbandon?.()
    return false
  }
  if (target.routeTarget.kind === 'git-branch') {
    return fromRoute === undefined
      ? await commitWorkspacePaneCurrentTargetRoute(target, route, navigation, options, presentationToken)
      : await commitWorkspacePaneExactTargetRoute(target, fromRoute, route, navigation, options, presentationToken)
  }
  if (!primaryWindowPresentationIsCurrent(presentationToken)) {
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
    presentationToken,
    onCommit: options?.onCommit,
    onAbandon: options?.onAbandon,
    routePrecondition: fromRoute === undefined ? undefined : { kind: 'exact-route', route: fromRoute },
  })
}

export async function commitWorkspacePaneControllerRoute(
  workspaceId: WorkspaceId,
  branchName: string,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneRouteCommitNavigation,
  options?: {
    replace?: boolean
    presentationToken?: PrimaryWindowPresentationToken
    routePrecondition?:
      { kind: 'exact-route'; route: ParsedWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
  },
): Promise<boolean> {
  return await navigation.commitWorkspacePaneRoute(workspaceId, branchName, route, {
    replace: options?.replace,
    presentationToken: options?.presentationToken,
    routePrecondition: options?.routePrecondition,
  })
}

export async function commitWorkspacePaneCurrentTargetRoute(
  target: WorkspacePaneControllerTarget,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneRouteCommitNavigation,
  options?: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void },
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
  navigation: WorkspacePaneRouteCommitNavigation,
  options?: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  return await commitWorkspacePaneValidatedTargetRoute(
    target,
    route,
    navigation,
    (candidate) =>
      candidate.branchName !== null &&
      workspacePaneCommittedRuntimeTargetIsCurrent({
        workspaceId: candidate.workspaceId,
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
  navigation: WorkspacePaneRouteCommitNavigation,
  targetIsCurrent: (target: WorkspacePaneControllerTarget) => boolean,
  commitSupplement: typeof commitWorkspacePaneRouteSupplement,
  useCurrentTargetPrecondition: boolean,
  options: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void } | undefined,
  presentationToken: PrimaryWindowPresentationToken,
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) {
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
      presentationToken,
      ...(useCurrentTargetPrecondition ? { routePrecondition: { kind: 'current-workspace-target' as const } } : {}),
    })
    const supplementCommitted =
      committed &&
      commitSupplement(
        {
          workspaceId: target.workspaceId,
          workspaceRuntimeId: target.workspaceRuntimeId,
          branchName,
          worktreePath: target.worktreePath,
        },
        route,
      )
    completed =
      committed &&
      supplementCommitted &&
      primaryWindowPresentationIsCurrent(presentationToken) &&
      targetIsCurrent(target)
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
  fromRoute: WorkspacePaneTabControllerObservedRoute | undefined,
  route: WorkspacePaneTabControllerRoute,
  navigation: WorkspacePaneRouteCommitNavigation,
  options?: { replace?: boolean; onCommit?: () => void; onAbandon?: () => void },
  presentationToken: PrimaryWindowPresentationToken = beginPrimaryWindowPresentation(),
): Promise<boolean> {
  if (!primaryWindowPresentationIsCurrent(presentationToken)) {
    options?.onAbandon?.()
    return false
  }
  const branchName = target.branchName
  if (!branchName || !workspacePaneTabControllerTargetIsCurrent(target)) {
    options?.onAbandon?.()
    return false
  }
  let completed = false
  try {
    const committed = await commitWorkspacePaneControllerRoute(target.workspaceId, branchName, route, navigation, {
      replace: options?.replace,
      presentationToken,
      routePrecondition: fromRoute === undefined ? undefined : { kind: 'exact-route', route: fromRoute },
    })
    const supplementCommitted =
      committed &&
      commitWorkspacePaneRouteSupplement(
        {
          workspaceId: target.workspaceId,
          workspaceRuntimeId: target.workspaceRuntimeId,
          branchName,
          worktreePath: target.worktreePath,
        },
        route,
      )
    completed =
      committed &&
      supplementCommitted &&
      primaryWindowPresentationIsCurrent(presentationToken) &&
      workspacePaneTabControllerTargetIsCurrent(target)
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
  if (target.branchName !== target.routeTarget.branchName) return false
  if (target.paneTarget.kind === 'git-branch') {
    return (
      target.branchName === target.paneTarget.branchName &&
      target.worktreePath === null &&
      workspacePaneTargetLeaseIsCurrent({
        workspaceId: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
        branchName: target.paneTarget.branchName,
        worktreePath: target.worktreePath,
      })
    )
  }
  if (target.paneTarget.kind === 'git-worktree') {
    if (target.worktreePath !== target.paneTarget.worktreePath) return false
    return (
      target.branchName !== null &&
      workspacePaneTargetLeaseIsCurrent({
        workspaceId: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
        branchName: target.branchName,
        worktreePath: target.paneTarget.worktreePath,
      })
    )
  }
  return false
}

function workspacePaneTabControllerRouteFromParsed(
  route: ParsedWorkspacePaneRouteTarget | undefined,
): WorkspacePaneTabControllerRoute | undefined {
  if (route === undefined || route?.kind === 'invalid-static') return undefined
  return route
}
