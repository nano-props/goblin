import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationActions, FilesystemWorkspacePaneRouteCommitActions } from '#/web/app/navigation/actions.ts'
import {
  requiredWorkspacePaneTabModelLocation,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { adjacentWorkspacePaneTab } from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneControllerRouteForTab,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { isWorkspacePaneRuntimeTabEntry, workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  resolveWorkspacePaneTabTargetForPaneTarget,
  workspacePaneLocationIsCurrent,
  workspacePaneTabTargetBlocksInteraction,
  type WorkspacePaneTabTargetResolution,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { beginAppNavigation, type AppNavigationGeneration } from '#/web/app/navigation/lifecycle.ts'
import {
  workspacePaneLocationBranchName,
  type WorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  location: WorkspacePaneLocation
  tabIndex: number
  navigation: AppNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  location: WorkspacePaneLocation
  direction: 1 | -1
  navigation: AppNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  location: WorkspacePaneLocation
  identity: string
  navigation: FilesystemWorkspacePaneRouteCommitActions
  onTerminalReselect?: (terminalSessionId: string) => void
  reselect?: boolean
}

export async function dispatchSelectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
): Promise<boolean> {
  if (options.workspaceId !== options.location.workspaceId || options.tabIndex < 1) return false
  const coordinatorTarget = selectableWorkspacePaneTarget(
    resolveSelectableWorkspacePaneTarget(options, options.workspacePaneRoute),
  )
  if (!coordinatorTarget || !workspacePaneLocationIsCurrent(coordinatorTarget.location)) return false
  const tab = coordinatorTarget.tabs[options.tabIndex - 1]
  if (
    !tab ||
    workspacePaneTabTargetBlocksInteraction(coordinatorTarget) ||
    tab.kind === 'pending' ||
    workspacePaneControllerRouteForTab(tab) === undefined
  ) {
    return false
  }
  const navigationGeneration = beginAppNavigation()
  return await runWorkspacePaneAction(requiredWorkspacePaneTabModelLocation(coordinatorTarget), () =>
    selectWorkspacePaneTabByIndexAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: AppNavigationGeneration,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, tabIndex, navigation } = options
  if (workspaceId !== options.location.workspaceId || tabIndex < 1) return false
  const sourceRoute = workspacePaneRoute
  const target = selectableWorkspacePaneTarget(resolveSelectableWorkspacePaneTarget(options, sourceRoute))
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(coordinatorTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation, { navigationGeneration })
}

export async function dispatchSelectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
): Promise<boolean> {
  if (options.workspaceId !== options.location.workspaceId) return false
  const coordinatorTarget = selectableWorkspacePaneTarget(
    resolveSelectableWorkspacePaneTarget(options, options.workspacePaneRoute),
  )
  if (!coordinatorTarget || !workspacePaneLocationIsCurrent(coordinatorTarget.location)) return false
  const tab = coordinatorTarget.tabs.find((candidate) => candidate.identity === options.identity) ?? null
  const tabEntry =
    coordinatorTarget.surfaceTabEntries.find(
      (candidate) => workspacePaneTabEntryIdentity(candidate) === options.identity,
    ) ?? null
  if (
    (!tab && !tabEntry) ||
    workspacePaneTabTargetBlocksInteraction(coordinatorTarget) ||
    tab?.kind === 'pending' ||
    (tab ? workspacePaneControllerRouteForTab(tab) === undefined : false) ||
    (!tab && tabEntry ? !isWorkspacePaneRuntimeTabEntry(tabEntry) || tabEntry.type !== 'terminal' : false)
  ) {
    return false
  }
  const navigationGeneration = beginAppNavigation()
  return await runWorkspacePaneAction(requiredWorkspacePaneTabModelLocation(coordinatorTarget), () =>
    selectWorkspacePaneTabByIdentityAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: AppNavigationGeneration,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, identity, navigation, onTerminalReselect, reselect } = options
  if (workspaceId !== options.location.workspaceId) return false
  const sourceRoute = workspacePaneRoute
  const target = selectableWorkspacePaneTarget(resolveSelectableWorkspacePaneTarget(options, sourceRoute))
  const tab = target?.tabs.find((candidate) => candidate.identity === identity) ?? null
  const tabEntry =
    target?.surfaceTabEntries.find((candidate) => workspacePaneTabEntryIdentity(candidate) === identity) ?? null
  if (!target || (!tab && !tabEntry) || !queuedWorkspacePaneTargetMatches(coordinatorTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab?.kind === 'pending') return false
  const committed = tab
    ? await selectWorkspacePaneControllerTab(target, tab, navigation, { navigationGeneration })
    : tabEntry
      ? await selectWorkspacePaneControllerTabEntry(target, tabEntry, navigation, navigationGeneration)
      : false
  if (committed && reselect && tab?.kind === 'runtime' && tab.runtimeType === 'terminal') {
    onTerminalReselect?.(tab.sessionId)
  }
  return committed
}

export async function dispatchMoveWorkspacePaneTabAction(options: MoveWorkspacePaneTabActionOptions): Promise<boolean> {
  if (options.workspaceId !== options.location.workspaceId) return false
  const coordinatorTarget = selectableWorkspacePaneTarget(
    resolveSelectableWorkspacePaneTarget(options, options.workspacePaneRoute),
  )
  if (!coordinatorTarget) return false
  return await runWorkspacePaneAction(requiredWorkspacePaneTabModelLocation(coordinatorTarget), () =>
    moveWorkspacePaneTabAction(options, coordinatorTarget),
  )
}

async function moveWorkspacePaneTabAction(
  options: MoveWorkspacePaneTabActionOptions,
  queuedTarget: WorkspacePaneTabModel,
): Promise<boolean> {
  const { workspaceId, direction, navigation } = options
  if (workspaceId !== options.location.workspaceId) return false
  const branchName = workspacePaneLocationBranchName(options.location)
  const currentRoute = branchName ? navigation.currentWorkspacePaneRoute(workspaceId, branchName) : undefined
  if (branchName && currentRoute === undefined) return false
  const target = selectableWorkspacePaneTarget(resolveSelectableWorkspacePaneTarget(options, currentRoute))
  const tab = target ? adjacentWorkspacePaneTab(target.tabs, target.selectedIdentity, direction) : null
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(queuedTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation)
}

function queuedWorkspacePaneTargetMatches(queued: WorkspacePaneTabModel, current: WorkspacePaneTabModel): boolean {
  if (!queued.location || !current.location) return false
  return (
    workspacePaneLocationIsCurrent(queued.location) &&
    current.location.workspaceRuntimeId === queued.location.workspaceRuntimeId &&
    current.location.kind === queued.location.kind &&
    workspacePaneTabsTargetIdentityKey(current.location.routeTarget) ===
      workspacePaneTabsTargetIdentityKey(queued.location.routeTarget)
  )
}

function resolveSelectableWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    location: WorkspacePaneLocation
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabTargetResolution {
  if (input.workspaceId !== input.location.workspaceId) return { kind: 'missing' }
  return resolveWorkspacePaneTabTargetForPaneTarget({
    location: input.location,
    workspacePaneRoute,
  })
}

function selectableWorkspacePaneTarget(resolution: WorkspacePaneTabTargetResolution): WorkspacePaneTabModel | null {
  return resolution.kind === 'missing' ? null : resolution.target
}
