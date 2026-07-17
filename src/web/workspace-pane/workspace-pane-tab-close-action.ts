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
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  selectWorkspacePaneControllerTab,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerPresentationLease,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { beginWorkspacePaneTabClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  terminalBaseForRuntimeTabCloseTarget,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForBranch,
  workspacePaneTabTargetForWorkspace,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  runWorkspacePaneAction,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { finishWorkspacePaneRouteIntent } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
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
  if (!options.repoId) return await closeWorkspacePaneTabAction(options)
  const coordinatorTarget = resolveCloseWorkspacePaneTarget(
    options.repoId,
    options.branchName,
    options.workspacePaneRoute,
  )
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(
    {
      repoId: coordinatorTarget.repoId,
      repoRuntimeId: coordinatorTarget.repoRuntimeId,
      branchName: coordinatorTarget.branchName,
      worktreePath: coordinatorTarget.worktreePath,
    },
    () =>
      closeWorkspacePaneTabAction({
        ...options,
        presentationToken,
        workspacePaneRoute: options.workspacePaneRoute,
      }),
  )
}

async function closeWorkspacePaneTabAction(options: CloseWorkspacePaneTabActionOptions): Promise<boolean> {
  const start = beginCloseWorkspacePaneTabAction(options)
  if (start.kind === 'done') return start.result
  return await runWorkspacePaneCloseTransition(start.presentationLease, async () => {
    if (!(await start.completion)) return false
    completeWorkspacePaneTabClose(start.target, start.closingIdentity)
    if (!start.wasActive) return true
    if (!workspacePaneTabControllerTargetIsCurrent(start.target)) return true
    if (!start.presentationLease) return start.target.branchName === null
    const presented = await commitWorkspacePaneControllerCloseBackTarget(start.presentationLease, options.navigation)
    return presented || !primaryWindowPresentationIsCurrent(start.presentationLease.presentationToken)
  })
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const queueRepoId = options.repoId ?? options.confirmedTerminal.base.repoRoot
  const queueRepoRuntimeId = options.confirmedTerminal.base.repoRuntimeId
  const workspaceRoot = options.confirmedTerminal.base.target?.kind === 'workspace-root'
  const queueBranchName = workspaceRoot ? null : (options.branchName ?? options.confirmedTerminal.base.branch)
  if (!queueRepoId || !queueRepoRuntimeId) return false
  let queueTarget: WorkspacePaneActionTarget
  if (workspaceRoot) {
    queueTarget = {
      kind: 'workspace-root',
      repoId: queueRepoId,
      repoRuntimeId: queueRepoRuntimeId,
      branchName: null,
      worktreePath: null,
    }
  } else {
    if (queueBranchName === null) return false
    queueTarget = {
      repoId: queueRepoId,
      repoRuntimeId: queueRepoRuntimeId,
      branchName: queueBranchName,
      worktreePath: options.confirmedTerminal.base.worktreePath,
    }
  }
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(queueTarget, () =>
    confirmCloseTerminalWorkspacePaneTabAction({ ...options, presentationToken }),
  )
}

async function confirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const { repoId, navigation, targetIdentity, confirmedTerminal } = options
  if (!confirmedTerminal.base.repoRuntimeId) return false
  const workspaceConfirmed = confirmedTerminal.base.target?.kind === 'workspace-root'
  const gitBranchName = workspaceConfirmed ? null : confirmedTerminal.base.branch
  if (!workspaceConfirmed && !gitBranchName) return false
  const confirmed: ConfirmedWorkspacePaneRuntimeTabClose = {
    type: 'terminal',
    sessionId: confirmedTerminal.terminalSessionId,
    target: {
      repoRoot: confirmedTerminal.base.repoRoot,
      repoRuntimeId: confirmedTerminal.base.repoRuntimeId,
      branchName: gitBranchName,
      worktreePath: confirmedTerminal.base.worktreePath,
    },
  }
  const confirmedIdentity = targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed)
  const closeTarget = repoId
    ? options.branchName
      ? resolveCloseWorkspacePaneTarget(repoId, options.branchName, options.workspacePaneRoute)
      : confirmedTerminal.base.target?.kind === 'workspace-root'
        ? workspacePaneTabTargetForWorkspace(repoId)
        : null
    : null
  const currentTarget =
    options.currentRepoId && options.currentRepoId === repoId
      ? options.currentBranchName
        ? workspacePaneTabTargetForBranch(options.currentRepoId, options.currentBranchName, {
            workspacePaneRoute: options.currentWorkspacePaneRoute,
          })
        : workspacePaneTabTargetForWorkspace(options.currentRepoId)
      : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) return false
  const tab = closeTarget?.tabs.find((candidate) => candidate.identity === confirmedIdentity) ?? null
  const selectedWorkspaceTerminal = workspaceConfirmed
    ? useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[
        formatTerminalWorktreeKey(confirmedTerminal.base.repoRoot, confirmedTerminal.base.worktreePath)
      ]
    : null
  const workspacePreference = workspaceConfirmed
    ? useReposStore.getState().repos[confirmedTerminal.base.repoRoot]?.ui.preferredWorkspacePaneTabByTarget[
        workspacePaneTabsTargetIdentityKey({
          kind: 'workspace-root',
          repoRoot: confirmedTerminal.base.repoRoot,
          branchName: null,
          worktreePath: null,
        })
      ]
    : null
  const workspaceRuntimeCurrent = workspaceConfirmed
    ? useReposStore.getState().repos[confirmedTerminal.base.repoRoot]?.repoRuntimeId ===
      confirmedTerminal.base.repoRuntimeId
    : false
  const wasActive = workspaceConfirmed
    ? workspaceRuntimeCurrent &&
      workspacePreference === 'terminal' &&
      selectedWorkspaceTerminal === confirmedTerminal.terminalSessionId
    : !!currentTarget &&
      currentTarget.branchName === gitBranchName &&
      currentTarget.activeTab?.identity === confirmedIdentity
  // Close the original runtime tab, but only drive close-back navigation when
  // the current routed pane is still showing that same tab.
  const openerIdentity =
    wasActive && closeTarget && tab && gitBranchName !== null
      ? workspacePaneTabOpener(closeTarget.repoId, closeTarget.repoRuntimeId, gitBranchName, tab.identity)
      : null
  const nextTab =
    wasActive && closeTarget && tab
      ? nextRepoWorkspaceTabAfterClose(closeTarget.tabs, tab.identity, openerIdentity)
      : wasActive && closeTarget && workspaceConfirmed
        ? (closeTarget.tabs.find((candidate) => candidate.type === 'files') ?? null)
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
      return false
    }
    if (!(await confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext))) {
      return false
    }
    if (closeTarget) {
      completeWorkspacePaneTabClose(
        closeTarget,
        targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed),
      )
    }
    if (workspaceConfirmed && wasActive) {
      if (closeTarget && nextTab) {
        return await selectWorkspacePaneControllerTab(closeTarget, nextTab, navigation)
      }
      const state = useReposStore.getState()
      if (state.repos[confirmedTerminal.base.repoRoot]?.repoRuntimeId !== confirmedTerminal.base.repoRuntimeId) {
        return true
      }
      state.setWorkspacePaneTabForTarget(
        {
          kind: 'workspace-root',
          repoRoot: confirmedTerminal.base.repoRoot,
          branchName: null,
          worktreePath: null,
        },
        'files',
      )
      return true
    }
    if (!wasActive || !closeTarget) return true
    if (!workspacePaneTabControllerTargetIsCurrent(closeTarget)) return true
    if (!presentationLease) {
      return nextTab ? await selectWorkspacePaneControllerTab(closeTarget, nextTab, navigation) : true
    }
    const presented = await commitWorkspacePaneControllerCloseBackTarget(presentationLease, navigation)
    return presented || !primaryWindowPresentationIsCurrent(presentationLease.presentationToken)
  })
}

function beginCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): CloseWorkspacePaneTabActionStart {
  const { repoId, targetIdentity } = options
  const skipRuntimeCloseConfirm = options.skipRuntimeCloseConfirm ?? options.skipTerminalCloseConfirm ?? false
  const target = repoId ? resolveCloseWorkspacePaneTarget(repoId, options.branchName, options.workspacePaneRoute) : null
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
    finishWorkspacePaneRouteIntent(presentationLease?.routeIntentId)
    return { kind: 'done', result: false }
  }
  if (!close.accepted) {
    finishWorkspacePaneRouteIntent(presentationLease?.routeIntentId)
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

function resolveCloseWorkspacePaneTarget(
  repoId: string,
  branchName: string | null,
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined,
): RepoWorkspaceTabModel | null {
  return branchName !== null
    ? workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
    : workspacePaneTabTargetForWorkspace(repoId, { workspacePaneRoute: undefined })
}

async function runWorkspacePaneCloseTransition(
  presentationLease: WorkspacePaneControllerPresentationLease | null,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await operation()
  } catch {
    return false
  } finally {
    finishWorkspacePaneRouteIntent(presentationLease?.routeIntentId)
  }
}
