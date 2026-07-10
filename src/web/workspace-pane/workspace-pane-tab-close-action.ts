import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  isRepoWorkspaceRuntimeTab,
  nextRepoWorkspaceTabAfterClose,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  abortWorkspacePaneTabControllerTransition,
  beginWorkspacePaneCloseActiveTabTransition,
  completeWorkspacePaneTabControllerTransition,
  commitWorkspacePaneControllerCloseBackTarget,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { beginWorkspacePaneTabClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  terminalBaseForRuntimeTabCloseTarget,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseBranchName,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import {
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import { runWorkspacePaneTabCoordinatorTask } from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

export interface CloseWorkspacePaneTabActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
}

export interface ConfirmedTerminalWorkspacePaneTabClose {
  terminalSessionId: string
  base: TerminalSessionBase
}

export interface ConfirmCloseTerminalWorkspacePaneTabActionOptions extends CloseWorkspacePaneTabActionOptions {
  currentRepoId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

type CloseWorkspacePaneTabActionStart =
  | { kind: 'done'; result: boolean }
  | {
      kind: 'started'
      target: RepoWorkspaceTabModel
      closingIdentity: string
      wasActive: boolean
      nextTab: RepoWorkspaceTab | null
      transitionId: number | null
      completion: Promise<boolean>
    }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName) return await closeWorkspacePaneTabAction(options)
  return await runWorkspacePaneTabCoordinatorTask({ repoId: options.repoId, branchName: options.branchName }, () =>
    closeWorkspacePaneTabAction(options),
  )
}

async function closeWorkspacePaneTabAction(options: CloseWorkspacePaneTabActionOptions): Promise<boolean> {
  const start = beginCloseWorkspacePaneTabAction(options)
  if (start.kind === 'done') return start.result
  if (!(await start.completion)) {
    abortWorkspacePaneTabControllerTransition(start.transitionId)
    return false
  }
  completeWorkspacePaneTabClose(start.target.repoId, start.target.branchName, start.closingIdentity)
  if (start.wasActive) {
    return await settleWorkspacePaneCloseBackNavigation(
      start.transitionId,
      commitWorkspacePaneControllerCloseBackTarget(start.target, start.nextTab, options.navigation),
    )
  }
  return true
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const queueRepoId = options.repoId ?? options.confirmedTerminal.base.repoRoot
  const queueBranchName = options.branchName ?? options.confirmedTerminal.base.branch
  if (!queueRepoId || !queueBranchName) return await confirmCloseTerminalWorkspacePaneTabAction(options)
  return await runWorkspacePaneTabCoordinatorTask(
    { repoId: queueRepoId, branchName: queueBranchName, worktreePath: options.confirmedTerminal.base.worktreePath },
    () => confirmCloseTerminalWorkspacePaneTabAction(options),
  )
}

async function confirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const { repoId, navigation, targetIdentity, confirmedTerminal } = options
  if (!confirmedTerminal.base.repoRuntimeId) return false
  const confirmed: ConfirmedWorkspacePaneRuntimeTabClose = {
    type: 'terminal',
    sessionId: confirmedTerminal.terminalSessionId,
    target: {
      repoRoot: confirmedTerminal.base.repoRoot,
      repoRuntimeId: confirmedTerminal.base.repoRuntimeId,
      branchName: confirmedTerminal.base.branch,
      worktreePath: confirmedTerminal.base.worktreePath,
    },
  }
  const confirmedBranchName = workspacePaneRuntimeTabConfirmedCloseBranchName(confirmed)
  if (!confirmedBranchName) return false
  const confirmedIdentity = targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed)
  const closeTarget =
    repoId && options.branchName
      ? workspacePaneTabTargetForBranch(repoId, options.branchName, {
          workspacePaneRoute: options.workspacePaneRoute,
        })
      : null
  const currentTarget =
    options.currentRepoId && options.currentRepoId === repoId && options.currentBranchName
      ? workspacePaneTabTargetForBranch(options.currentRepoId, options.currentBranchName, {
          workspacePaneRoute: options.currentWorkspacePaneRoute,
        })
      : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) return false
  const tab = closeTarget?.tabs.find((candidate) => candidate.identity === confirmedIdentity) ?? null
  const wasActive =
    !!currentTarget &&
    currentTarget.branchName === confirmedBranchName &&
    currentTarget.activeTab?.identity === confirmedIdentity
  // Close the original runtime tab, but only drive close-back navigation when
  // the current routed pane is still showing that same tab.
  const openerIdentity =
    wasActive && closeTarget && tab
      ? workspacePaneTabOpener(closeTarget.repoId, confirmedBranchName, tab.identity)
      : null
  const nextTab =
    wasActive && closeTarget && tab
      ? nextRepoWorkspaceTabAfterClose(closeTarget.tabs, tab.identity, openerIdentity)
      : null
  const transitionId =
    wasActive && closeTarget && tab
      ? beginWorkspacePaneCloseActiveTabTransition({
          target: closeTarget,
          closingTab: tab,
          nextTab,
          workspacePaneRoute: options.currentWorkspacePaneRoute,
        })
      : null
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  if (!canConfirmWorkspacePaneRuntimeTabCloseWithContext(confirmed, closeContext)) {
    abortWorkspacePaneTabControllerTransition(transitionId)
    return false
  }
  if (!(await confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext))) {
    abortWorkspacePaneTabControllerTransition(transitionId)
    return false
  }
  completeWorkspacePaneTabClose(
    repoId,
    confirmedBranchName,
    targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed),
  )
  if (wasActive && closeTarget) {
    return await settleWorkspacePaneCloseBackNavigation(
      transitionId,
      commitWorkspacePaneControllerCloseBackTarget(closeTarget, nextTab, navigation),
    )
  }
  return true
}

function beginCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): CloseWorkspacePaneTabActionStart {
  const { repoId, targetIdentity } = options
  const skipRuntimeCloseConfirm = options.skipRuntimeCloseConfirm ?? options.skipTerminalCloseConfirm ?? false
  const target =
    repoId && options.branchName
      ? workspacePaneTabTargetForBranch(repoId, options.branchName, {
          workspacePaneRoute: options.workspacePaneRoute,
        })
      : null
  if (!target) return { kind: 'done', result: false }
  if (workspacePaneTabTargetBlocksInteraction(target)) return { kind: 'done', result: true }
  const tab = targetIdentity
    ? (target.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target.activeTab ?? null)
  if (!tab) return { kind: 'done', result: false }
  if (!skipRuntimeCloseConfirm && isRepoWorkspaceRuntimeTab(tab)) {
    const closeConfirm = workspacePaneRuntimeTabCloseConfirmRequest({
      type: tab.runtimeType,
      identity: tab.identity,
      sessionId: tab.sessionId,
      view: tab.view,
      target: {
        repoRoot: target.repoId,
        repoRuntimeId: target.repoRuntimeId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
      },
    })
    if (openWorkspacePaneRuntimeCloseConfirm(target.repoId, closeConfirm, options.workspacePaneRoute)) {
      return { kind: 'done', result: true }
    }
  }

  const closingIdentity = tab.identity
  const wasActive = target.activeTab?.identity === closingIdentity
  const openerIdentity =
    wasActive && target.branchName ? workspacePaneTabOpener(target.repoId, target.branchName, closingIdentity) : null
  const nextTab = wasActive ? nextRepoWorkspaceTabAfterClose(target.tabs, closingIdentity, openerIdentity) : null
  const transitionId = wasActive
    ? beginWorkspacePaneCloseActiveTabTransition({
        target,
        closingTab: tab,
        nextTab,
        workspacePaneRoute: options.workspacePaneRoute,
      })
    : null
  const close = beginWorkspacePaneTabClose(target, tab)
  if (!close.accepted) {
    abortWorkspacePaneTabControllerTransition(transitionId)
    return { kind: 'done', result: false }
  }
  return {
    kind: 'started',
    target,
    closingIdentity,
    wasActive,
    nextTab,
    transitionId,
    completion: close.completion,
  }
}

function openWorkspacePaneRuntimeCloseConfirm(
  repoId: string,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
): boolean {
  if (!request) return false
  const terminalBase = request.type === 'terminal' ? terminalBaseForRuntimeTabCloseTarget(request.target) : null
  if (request.type === 'terminal' && terminalBase && request.processName) {
    useTerminalActionDialogsStore.getState().openCloseConfirm({
      repoId,
      targetIdentity: request.identity,
      workspacePaneRoute,
      terminalSessionId: request.sessionId,
      terminalBase,
      processName: request.processName,
    })
    return true
  }
  return false
}

function completeWorkspacePaneTabClose(repoId: string | null, branchName: string | null, identity: string): void {
  if (repoId && branchName) clearWorkspacePaneTabOpener(repoId, branchName, identity)
}

async function settleWorkspacePaneCloseBackNavigation(
  transitionId: number | null,
  navigation: boolean | Promise<boolean>,
): Promise<boolean> {
  const settlesRoute = typeof navigation !== 'boolean'
  try {
    const committed = await navigation
    if (!committed) abortWorkspacePaneTabControllerTransition(transitionId)
    else if (settlesRoute) completeWorkspacePaneTabControllerTransition(transitionId)
    return committed
  } catch {
    abortWorkspacePaneTabControllerTransition(transitionId)
    return false
  }
}
