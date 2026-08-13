import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { adjacentWorkspacePaneTab } from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneControllerRouteForTab,
  workspacePaneTabControllerTargetIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { isWorkspacePaneRuntimeTabEntry, workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { beginAppNavigation, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  workspaceId: WorkspaceId | null
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  tabIndex: number
  navigation: AppNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  direction: 1 | -1
  navigation: AppNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  workspaceId: WorkspaceId | null
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  identity: string
  navigation: AppNavigationActions
  onTerminalReselect?: (terminalSessionId: string) => void
  reselect?: boolean
}

export async function dispatchSelectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
): Promise<boolean> {
  if (!options.workspaceId || options.tabIndex < 1) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget || !workspacePaneTabControllerTargetIsCurrent(coordinatorTarget)) return false
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
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIndexAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: AppNavigationGeneration,
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
  if (!coordinatorTarget || !workspacePaneTabControllerTargetIsCurrent(coordinatorTarget)) return false
  const tab = coordinatorTarget.tabs.find((candidate) => candidate.identity === options.identity) ?? null
  const tabEntry =
    coordinatorTarget.tabEntries.find((candidate) => workspacePaneTabEntryIdentity(candidate) === options.identity) ??
    null
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
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIdentityAction(options, coordinatorTarget, navigationGeneration),
  )
}

async function selectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
  coordinatorTarget: WorkspacePaneTabModel,
  navigationGeneration: AppNavigationGeneration,
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
  return await selectWorkspacePaneControllerTab(target, tab, navigation)
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
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
}): WorkspacePaneTabModel | null {
  if (!input.workspaceId) return null
  const target = resolveSelectableWorkspacePaneTarget(input, input.workspacePaneRoute)
  return target?.workspaceRuntimeId === input.workspaceRuntimeId ? target : null
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
