import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { adjacentWorkspacePaneTab, type WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneTabControllerTargetIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import { dispatchWorkspacePaneDestinationRoute } from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  beginPrimaryWindowNavigation,
  type PrimaryWindowNavigationGeneration,
} from '#/web/primary-window-navigation-lifecycle.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  identity: string
  navigation: PrimaryWindowNavigationActions
  onTerminalReselect?: (terminalSessionId: string) => void
  reselect?: boolean
}

export interface ShowWorkspacePaneTerminalRouteActionOptions {
  workspaceId: WorkspaceId | null
  branchName: string | null
  terminalSessionId: string
  navigation: PrimaryWindowNavigationActions
}

export async function dispatchSelectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
): Promise<boolean> {
  if (!options.workspaceId || options.tabIndex < 1) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const navigationGeneration = beginPrimaryWindowNavigation()
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIndexAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: PrimaryWindowNavigationGeneration,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, tabIndex, navigation } = options
  if (!workspaceId || tabIndex < 1) return false
  const sourceRoute = workspacePaneRoute
  const target = resolveSelectableWorkspacePaneTarget(options, sourceRoute)
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(coordinatorTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation, { navigationGeneration })
}

export async function dispatchSelectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const navigationGeneration = beginPrimaryWindowNavigation()
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIdentityAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: PrimaryWindowNavigationGeneration,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, identity, navigation, onTerminalReselect, reselect } = options
  if (!workspaceId) return false
  const sourceRoute = workspacePaneRoute
  const target = resolveSelectableWorkspacePaneTarget(options, sourceRoute)
  const tab = target?.tabs.find((candidate) => candidate.identity === identity) ?? null
  const tabEntry = target?.tabEntries.find((candidate) => workspacePaneTabEntryIdentity(candidate) === identity) ?? null
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

export async function dispatchShowWorkspacePaneTerminalRouteAction(
  options: ShowWorkspacePaneTerminalRouteActionOptions,
): Promise<WorkspacePaneActionOutcome> {
  if (!options.workspaceId || !options.branchName) return { kind: 'target-missing' }
  return await dispatchWorkspacePaneDestinationRoute({
    workspaceId: options.workspaceId,
    branchName: options.branchName,
    route: { kind: 'terminal', terminalSessionId: options.terminalSessionId },
    navigation: options.navigation,
  })
}

export async function dispatchMoveWorkspacePaneTabAction(options: MoveWorkspacePaneTabActionOptions): Promise<boolean> {
  if (!options.workspaceId) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    moveWorkspacePaneTabAction(options, coordinatorTarget),
  )
}

async function moveWorkspacePaneTabAction(
  options: MoveWorkspacePaneTabActionOptions,
  queuedTarget: WorkspacePaneTabModel,
): Promise<boolean> {
  const { workspaceId, direction, navigation } = options
  if (!workspaceId) return false
  const branchName = paneTargetPresentationBranch(options.paneTarget, options.worktreeHead)
  const currentRoute = branchName ? navigation.currentWorkspacePaneRoute(workspaceId, branchName) : undefined
  if (branchName && currentRoute === undefined) return false
  const target = resolveSelectableWorkspacePaneTarget(options, currentRoute)
  const tab = target ? adjacentWorkspacePaneTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(queuedTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation, {
    navigationGeneration: beginPrimaryWindowNavigation(),
  })
}

function queuedWorkspacePaneTargetMatches(queued: WorkspacePaneTabModel, current: WorkspacePaneTabModel): boolean {
  return (
    workspacePaneTabControllerTargetIsCurrent(queued) &&
    current.workspaceId === queued.workspaceId &&
    current.workspaceRuntimeId === queued.workspaceRuntimeId &&
    current.branchName === queued.branchName &&
    current.worktreePath === queued.worktreePath
  )
}

function workspacePaneTabActionCoordinatorTarget(input: {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
}): WorkspacePaneTabModel | null {
  if (!input.workspaceId) return null
  return resolveSelectableWorkspacePaneTarget(input, input.workspacePaneRoute)
}

function resolveSelectableWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    routeTarget: WorkspacePaneTabsTarget
    paneTarget: WorkspacePaneTabsTarget
    worktreeHead?: GitHead
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabModel | null {
  if (!input.workspaceId) return null
  return workspacePaneTabTargetForPaneTarget({
    paneTarget: input.paneTarget,
    routeTarget: input.routeTarget,
    workspacePaneRoute,
    worktreeHead: input.worktreeHead,
  })
}

function paneTargetPresentationBranch(
  target: WorkspacePaneTabsTarget,
  worktreeHead: GitHead | undefined,
): string | null {
  if (target.kind === 'git-branch') return target.branchName
  return target.kind === 'git-worktree' && worktreeHead ? gitHeadBranch(worktreeHead) : null
}

function workspacePaneQueuedActionTarget(model: WorkspacePaneTabModel) {
  return workspacePaneActionTargetFromCoordinates({
    workspaceId: model.workspaceId,
    workspaceRuntimeId: model.workspaceRuntimeId,
    branchName: model.branchName,
    worktreePath: model.worktreePath,
  })
}
