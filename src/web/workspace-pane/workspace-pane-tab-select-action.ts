import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { adjacentRepoWorkspaceTab, type RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  selectWorkspacePaneControllerTab,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { dispatchWorkspacePaneDestinationRoute } from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { beginPrimaryWindowPresentation, type PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'

export interface SelectWorkspacePaneTabByIndexActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

export interface MoveWorkspacePaneTabActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export interface SelectWorkspacePaneTabByIdentityActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  identity: string
  navigation: PrimaryWindowNavigationActions
  runtimeActionContext?: WorkspacePaneRuntimeTabActionContext
  reselect?: boolean
}

export interface ShowWorkspacePaneTerminalRouteActionOptions {
  repoId: string | null
  branchName: string | null
  terminalSessionId: string
  navigation: PrimaryWindowNavigationActions
}

export async function dispatchSelectWorkspacePaneTabByIndexAction(
  options: SelectWorkspacePaneTabByIndexActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName || options.tabIndex < 1) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(coordinatorTarget, () =>
    selectWorkspacePaneTabByIndexAction(options, coordinatorTarget, presentationToken),
  )
}

async function selectWorkspacePaneTabByIndexAction({
  repoId,
  branchName,
  workspacePaneRoute,
  tabIndex,
  navigation,
}: SelectWorkspacePaneTabByIndexActionOptions, coordinatorTarget: RepoWorkspaceTabModel, presentationToken: PrimaryWindowPresentationToken): Promise<boolean> {
  if (!repoId || !branchName || tabIndex < 1) return false
  const sourceRoute = workspacePaneRoute
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: sourceRoute })
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return await selectWorkspacePaneControllerTab(target, tab, sourceRoute, navigation, presentationToken)
}

export async function dispatchSelectWorkspacePaneTabByIdentityAction(
  options: SelectWorkspacePaneTabByIdentityActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(coordinatorTarget, () =>
    selectWorkspacePaneTabByIdentityAction(options, coordinatorTarget, presentationToken),
  )
}

async function selectWorkspacePaneTabByIdentityAction({
  repoId,
  branchName,
  workspacePaneRoute,
  identity,
  navigation,
  runtimeActionContext,
  reselect,
}: SelectWorkspacePaneTabByIdentityActionOptions, coordinatorTarget: RepoWorkspaceTabModel, presentationToken: PrimaryWindowPresentationToken): Promise<boolean> {
  if (!repoId || !branchName) return false
  const sourceRoute = workspacePaneRoute
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: sourceRoute })
  const tab = target?.tabs.find((candidate) => candidate.identity === identity) ?? null
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  const committed = await selectWorkspacePaneControllerTab(target, tab, sourceRoute, navigation, presentationToken)
  if (committed && reselect && tab.kind === 'runtime' && tab.runtimeType === 'terminal') {
    runtimeActionContext?.terminal?.scrollToBottom?.(tab.sessionId)
  }
  return committed
}

export async function dispatchShowWorkspacePaneTerminalRouteAction(
  options: ShowWorkspacePaneTerminalRouteActionOptions,
): Promise<WorkspacePaneActionOutcome> {
  if (!options.repoId || !options.branchName) return { kind: 'target-missing' }
  return await dispatchWorkspacePaneDestinationRoute({
    repoId: options.repoId,
    branchName: options.branchName,
    route: { kind: 'terminal', terminalSessionId: options.terminalSessionId },
    navigation: options.navigation,
  })
}

export async function dispatchMoveWorkspacePaneTabAction(options: MoveWorkspacePaneTabActionOptions): Promise<boolean> {
  if (!options.repoId || !options.branchName) return false
  const coordinatorTarget = workspacePaneTabActionCoordinatorTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  const targetIdentity = adjacentRepoWorkspaceTab(
    coordinatorTarget.tabs,
    coordinatorTarget.activeTab?.identity,
    options.direction,
  )?.identity
  if (!targetIdentity) return false
  return await runWorkspacePaneAction(coordinatorTarget, () =>
    moveWorkspacePaneTabAction(options, coordinatorTarget, presentationToken, targetIdentity),
  )
}

async function moveWorkspacePaneTabAction({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
}: MoveWorkspacePaneTabActionOptions, coordinatorTarget: RepoWorkspaceTabModel, presentationToken: PrimaryWindowPresentationToken, targetIdentity: string): Promise<boolean> {
  if (!repoId || !branchName) return false
  const sourceRoute = workspacePaneRoute
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute: sourceRoute })
  const tab = target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return await selectWorkspacePaneControllerTab(target, tab, sourceRoute, navigation, presentationToken)
}

function workspacePaneTabActionCoordinatorTarget(input: {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
}): RepoWorkspaceTabModel | null {
  if (!input.repoId || !input.branchName) return null
  return workspacePaneTabTargetForBranch(input.repoId, input.branchName, {
    workspacePaneRoute: input.workspacePaneRoute,
  })
}
