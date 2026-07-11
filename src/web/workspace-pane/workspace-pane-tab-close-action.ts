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
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerPresentationLease,
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
import {
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorObservedRoute,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'
import {
  beginPrimaryWindowPresentation,
  primaryWindowPresentationIsCurrent,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'

export interface CloseWorkspacePaneTabActionOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
  presentationToken?: PrimaryWindowPresentationToken
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
      presentationLease: WorkspacePaneControllerPresentationLease | null
      completion: Promise<boolean>
    }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  if (!options.repoId || !options.branchName) return await closeWorkspacePaneTabAction(options)
  const coordinatorTarget = workspacePaneTabTargetForBranch(options.repoId, options.branchName, {
    workspacePaneRoute: options.workspacePaneRoute,
  })
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneTabCoordinatorTask(coordinatorTarget, () =>
    closeWorkspacePaneTabAction({
      ...options,
      presentationToken,
      workspacePaneRoute: workspacePaneTabCoordinatorObservedRoute(coordinatorTarget) ?? options.workspacePaneRoute,
    }),
  )
}

async function closeWorkspacePaneTabAction(options: CloseWorkspacePaneTabActionOptions): Promise<boolean> {
  const start = beginCloseWorkspacePaneTabAction(options)
  if (start.kind === 'done') return start.result
  return await runWorkspacePaneCloseTransition(start.presentationLease, async () => {
    if (!(await start.completion)) return abortWorkspacePaneCloseTransition(start.presentationLease)
    completeWorkspacePaneTabClose(start.target, start.closingIdentity)
    if (!start.wasActive) return true
    if (!workspacePaneTabControllerTargetIsCurrent(start.target)) {
      abortWorkspacePaneTabControllerTransition(start.presentationLease?.transitionId)
      return true
    }
    if (!start.presentationLease) return false
    const presented = await commitWorkspacePaneControllerCloseBackTarget(start.presentationLease, options.navigation)
    return presented || !primaryWindowPresentationIsCurrent(start.presentationLease.presentationToken)
  })
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const queueRepoId = options.repoId ?? options.confirmedTerminal.base.repoRoot
  const queueRepoRuntimeId = options.confirmedTerminal.base.repoRuntimeId
  const queueBranchName = options.branchName ?? options.confirmedTerminal.base.branch
  if (!queueRepoId || !queueRepoRuntimeId || !queueBranchName) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneTabCoordinatorTask(
    {
      repoId: queueRepoId,
      repoRuntimeId: queueRepoRuntimeId,
      branchName: queueBranchName,
      worktreePath: options.confirmedTerminal.base.worktreePath,
    },
    () => confirmCloseTerminalWorkspacePaneTabAction({ ...options, presentationToken }),
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
      ? workspacePaneTabOpener(closeTarget.repoId, closeTarget.repoRuntimeId, confirmedBranchName, tab.identity)
      : null
  const nextTab =
    wasActive && closeTarget && tab
      ? nextRepoWorkspaceTabAfterClose(closeTarget.tabs, tab.identity, openerIdentity)
      : null
  const presentationLease =
    wasActive && closeTarget && tab
      ? beginWorkspacePaneCloseActiveTabPresentationLease({
          target: closeTarget,
          closingTab: tab,
          nextTab,
          workspacePaneRoute: options.currentWorkspacePaneRoute,
          presentationToken: options.presentationToken,
        })
      : null
  return await runWorkspacePaneCloseTransition(presentationLease, async () => {
    const closeContext = readWorkspacePaneRuntimeTabCloseContext()
    if (!canConfirmWorkspacePaneRuntimeTabCloseWithContext(confirmed, closeContext)) {
      return abortWorkspacePaneCloseTransition(presentationLease)
    }
    if (!(await confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext))) {
      return abortWorkspacePaneCloseTransition(presentationLease)
    }
    if (closeTarget) {
      completeWorkspacePaneTabClose(
        closeTarget,
        targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed),
      )
    }
    if (!wasActive || !closeTarget) return true
    if (!workspacePaneTabControllerTargetIsCurrent(closeTarget)) {
      abortWorkspacePaneTabControllerTransition(presentationLease?.transitionId)
      return true
    }
    if (!presentationLease) return false
    const presented = await commitWorkspacePaneControllerCloseBackTarget(presentationLease, navigation)
    return presented || !primaryWindowPresentationIsCurrent(presentationLease.presentationToken)
  })
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
    wasActive && target.branchName
      ? workspacePaneTabOpener(target.repoId, target.repoRuntimeId, target.branchName, closingIdentity)
      : null
  const nextTab = wasActive ? nextRepoWorkspaceTabAfterClose(target.tabs, closingIdentity, openerIdentity) : null
  const presentationLease = wasActive
    ? beginWorkspacePaneCloseActiveTabPresentationLease({
        target,
        closingTab: tab,
        nextTab,
        workspacePaneRoute: options.workspacePaneRoute,
        presentationToken: options.presentationToken,
      })
    : null
  let close
  try {
    close = beginWorkspacePaneTabClose(target, tab)
  } catch {
    abortWorkspacePaneTabControllerTransition(presentationLease?.transitionId)
    return { kind: 'done', result: false }
  }
  if (!close.accepted) {
    abortWorkspacePaneTabControllerTransition(presentationLease?.transitionId)
    return { kind: 'done', result: false }
  }
  return {
    kind: 'started',
    target,
    closingIdentity,
    wasActive,
    nextTab,
    presentationLease,
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

function completeWorkspacePaneTabClose(target: RepoWorkspaceTabModel, identity: string): void {
  if (!target.branchName) return
  clearWorkspacePaneTabOpener(target.repoId, target.repoRuntimeId, target.branchName, identity)
}

async function runWorkspacePaneCloseTransition(
  presentationLease: WorkspacePaneControllerPresentationLease | null,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await operation()
  } catch {
    return abortWorkspacePaneCloseTransition(presentationLease)
  }
}

function abortWorkspacePaneCloseTransition(presentationLease: WorkspacePaneControllerPresentationLease | null): false {
  abortWorkspacePaneTabControllerTransition(presentationLease?.transitionId)
  return false
}
