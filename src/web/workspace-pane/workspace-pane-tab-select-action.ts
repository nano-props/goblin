import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { adjacentRepoWorkspaceTab, type RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneTabControllerTargetIsCurrent,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import { dispatchWorkspacePaneDestinationRoute } from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  beginPrimaryWindowPresentation,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  identity: string
  navigation: PrimaryWindowNavigationActions
  runtimeActionContext?: WorkspacePaneRuntimeTabActionContext
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
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIndexAction(options, coordinatorTarget, presentationToken),
  )
}

async function selectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
  coordinatorTarget: RepoWorkspaceTabModel,
  presentationToken: PrimaryWindowPresentationToken,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, tabIndex, navigation } = options
  if (!workspaceId || tabIndex < 1) return false
  const sourceRoute = workspacePaneRoute
  const target = resolveSelectableWorkspacePaneTarget(options, sourceRoute)
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(coordinatorTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation, presentationToken)
}

export async function dispatchSelectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
): Promise<boolean> {
  if (!options.workspaceId) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(workspacePaneQueuedActionTarget(coordinatorTarget), () =>
    selectWorkspacePaneTabByIdentityAction(options, coordinatorTarget, presentationToken),
  )
}

async function selectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
  coordinatorTarget: RepoWorkspaceTabModel,
  presentationToken: PrimaryWindowPresentationToken,
): Promise<boolean> {
  const { workspaceId, workspacePaneRoute, identity, navigation, runtimeActionContext, reselect } = options
  if (!workspaceId) return false
  const sourceRoute = workspacePaneRoute
  const target = resolveSelectableWorkspacePaneTarget(options, sourceRoute)
  const tab = target?.tabs.find((candidate) => candidate.identity === identity) ?? null
  const tabEntry = target?.tabEntries.find((candidate) => workspacePaneTabEntryIdentity(candidate) === identity) ?? null
  if (!target || (!tab && !tabEntry) || !queuedWorkspacePaneTargetMatches(coordinatorTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab?.kind === 'pending') return false
  const committed = tab
    ? await selectWorkspacePaneControllerTab(target, tab, navigation, presentationToken)
    : tabEntry
      ? await selectWorkspacePaneControllerTabEntry(target, tabEntry, navigation, presentationToken)
      : false
  if (committed && reselect && tab?.kind === 'runtime' && tab.runtimeType === 'terminal') {
    runtimeActionContext?.terminal?.scrollToBottom?.(tab.sessionId)
  }
  return committed
}

export async function dispatchShowWorkspacePaneTerminalRouteAction(
  options: ShowWorkspacePaneTerminalRouteActionOptions,
): Promise<WorkspacePaneActionOutcome> {
  if (!options.workspaceId || !options.branchName) return { kind: 'target-missing' }
  return await dispatchWorkspacePaneDestinationRoute({
    repoId: options.workspaceId,
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
  queuedTarget: RepoWorkspaceTabModel,
): Promise<boolean> {
  const { workspaceId, direction, navigation } = options
  if (!workspaceId) return false
  const branchName = paneTargetPresentationBranch(options.paneTarget, options.worktreeHead)
  const currentRoute = branchName ? navigation.currentWorkspacePaneRoute(workspaceId, branchName) : undefined
  if (branchName && currentRoute === undefined) return false
  const target = resolveSelectableWorkspacePaneTarget(options, currentRoute)
  const tab = target ? adjacentRepoWorkspaceTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab || !queuedWorkspacePaneTargetMatches(queuedTarget, target)) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return await selectWorkspacePaneControllerTab(target, tab, navigation, beginPrimaryWindowPresentation())
}

function queuedWorkspacePaneTargetMatches(queued: RepoWorkspaceTabModel, current: RepoWorkspaceTabModel): boolean {
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
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
}): RepoWorkspaceTabModel | null {
  if (!input.workspaceId) return null
  return resolveSelectableWorkspacePaneTarget(input, input.workspacePaneRoute)
}

function resolveSelectableWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    paneTarget: WorkspacePaneTabsTarget
    worktreeHead?: GitHead
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): RepoWorkspaceTabModel | null {
  if (!input.workspaceId) return null
  return workspacePaneTabTargetForPaneTarget(input.paneTarget, workspacePaneRoute, input.worktreeHead)
}

function paneTargetPresentationBranch(
  target: WorkspacePaneTabsTarget,
  worktreeHead: GitHead | undefined,
): string | null {
  if (target.kind === 'git-branch') return target.branchName
  return target.kind === 'git-worktree' && worktreeHead ? gitHeadBranch(worktreeHead) : null
}

function workspacePaneQueuedActionTarget(model: RepoWorkspaceTabModel) {
  return workspacePaneActionTargetFromCoordinates({
    workspaceId: model.workspaceId,
    workspaceRuntimeId: model.workspaceRuntimeId,
    branchName: model.branchName,
    worktreePath: model.worktreePath,
  })
}
