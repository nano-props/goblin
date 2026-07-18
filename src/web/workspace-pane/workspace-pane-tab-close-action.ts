import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { GitHead } from '#/shared/git-head.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import {
  isRepoWorkspaceRuntimeTab,
  nextWorkspacePaneTabEntryAfterClose,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerPresentationLease,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { beginWorkspacePaneTabEntryClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { workspacePaneTabEntryIdentity, type WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  terminalBaseForRuntimeTabCloseTarget,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import { workspacePaneTerminalBaseFromCoordinates } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionTargetFromFilesystemTarget,
  runWorkspacePaneAction,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { finishWorkspacePaneRouteIntent } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  beginPrimaryWindowPresentation,
  type PrimaryWindowPresentationToken,
} from '#/web/primary-window-presentation.ts'
import { terminalLog } from '#/web/logger.ts'

export interface CloseWorkspacePaneTabActionOptions {
  workspaceId: string | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  runtimeView?: WorkspacePaneRuntimeTabSummary
  selectedIdentity?: string | null
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
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

type CloseWorkspacePaneTabActionStart =
  | { kind: 'done'; result: boolean }
  | {
      kind: 'started'
      target: RepoWorkspaceTabModel
      closingIdentity: string
      wasActive: boolean
      nextEntry: WorkspacePaneTabEntry | null
      presentationLease: WorkspacePaneControllerPresentationLease | null
      completion: Promise<boolean>
    }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  if (!options.workspaceId) return await closeWorkspacePaneTabAction(options)
  const coordinatorTarget = resolveCloseWorkspacePaneTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: coordinatorTarget.workspaceId,
      workspaceRuntimeId: coordinatorTarget.workspaceRuntimeId,
      branchName: coordinatorTarget.branchName,
      worktreePath: coordinatorTarget.worktreePath,
    }),
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
    if (!(await completeWorkspacePaneTabLifecycle(start.completion))) return false
    completeWorkspacePaneTabClose(start.target, start.closingIdentity)
    if (!start.wasActive) return true
    if (!workspacePaneTabControllerTargetIsCurrent(start.target)) return true
    if (!start.presentationLease) {
      if (start.nextEntry) {
        await selectWorkspacePaneControllerTabEntry(start.target, start.nextEntry, options.navigation)
      }
      return true
    }
    await commitWorkspacePaneControllerCloseBackTarget(start.presentationLease, options.navigation)
    return true
  })
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const base = options.confirmedTerminal.base
  const coordinates = terminalExecutionCoordinates(base.target)
  const queueRepoId = options.workspaceId ?? coordinates.repoRoot
  const queueWorkspaceRuntimeId = coordinates.workspaceRuntimeId
  if (queueRepoId !== coordinates.repoRoot) return false
  const queueTarget = workspacePaneActionTargetFromFilesystemTarget(base.target)
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(queueTarget, () =>
    confirmCloseTerminalWorkspacePaneTabAction({ ...options, presentationToken }),
  )
}

async function confirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const { workspaceId, navigation, targetIdentity, confirmedTerminal } = options
  const confirmed: ConfirmedWorkspacePaneRuntimeTabClose = {
    type: 'terminal',
    sessionId: confirmedTerminal.terminalSessionId,
    target: confirmedTerminal.base,
  }
  const confirmedIdentity = targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed)
  const closeTarget = workspaceId ? resolveCloseWorkspacePaneTarget(options) : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) return false
  const transition = closeTarget
    ? workspacePaneCloseTransition(
        closeTarget,
        confirmedIdentity,
        options.currentWorkspacePaneRoute,
        options.presentationToken,
        options.selectedIdentity,
      )
    : null
  return await runWorkspacePaneCloseTransition(transition?.presentationLease ?? null, async () => {
    const closeContext = readWorkspacePaneRuntimeTabCloseContext()
    if (!canConfirmWorkspacePaneRuntimeTabCloseWithContext(confirmed, closeContext)) {
      return false
    }
    if (!(await completeWorkspacePaneTabLifecycle(confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext)))) {
      return false
    }
    if (closeTarget) {
      completeWorkspacePaneTabClose(closeTarget, confirmedIdentity)
    }
    if (!transition?.wasActive || !closeTarget) return true
    if (!workspacePaneTabControllerTargetIsCurrent(closeTarget)) return true
    if (!transition.presentationLease) {
      if (transition.nextEntry) {
        await selectWorkspacePaneControllerTabEntry(closeTarget, transition.nextEntry, navigation)
      }
      return true
    }
    await commitWorkspacePaneControllerCloseBackTarget(transition.presentationLease, navigation)
    return true
  })
}

function beginCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): CloseWorkspacePaneTabActionStart {
  const { workspaceId, targetIdentity } = options
  const skipRuntimeCloseConfirm = options.skipRuntimeCloseConfirm ?? options.skipTerminalCloseConfirm ?? false
  const target = workspaceId ? resolveCloseWorkspacePaneTarget(options) : null
  if (!target) return { kind: 'done', result: false }
  if (workspacePaneTabTargetBlocksInteraction(target)) return { kind: 'done', result: true }
  const tabEntry = targetIdentity
    ? (target.tabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === targetIdentity) ?? null)
    : target.selectedEntry
  if (!tabEntry) return { kind: 'done', result: false }
  const closingIdentity = workspacePaneTabEntryIdentity(tabEntry)
  const tab = target.tabs.find((candidate) => candidate.identity === closingIdentity) ?? null
  const runtimeView = tab && isRepoWorkspaceRuntimeTab(tab) ? tab.view : options.runtimeView
  if (!skipRuntimeCloseConfirm && runtimeView?.type === 'terminal') {
    const terminalBase = terminalBaseForPaneModel(target)
    if (!terminalBase) return { kind: 'done', result: false }
    const closeConfirm = workspacePaneRuntimeTabCloseConfirmRequest({
      type: runtimeView.type,
      identity: closingIdentity,
      sessionId: runtimeView.terminalSessionId,
      view: runtimeView,
      target: terminalBase,
    })
    if (
      openWorkspacePaneRuntimeCloseConfirm(
        target.workspaceId,
        closeConfirm,
        options.workspacePaneRoute,
        options.selectedIdentity ?? target.selectedIdentity,
      )
    ) {
      return { kind: 'done', result: true }
    }
  }

  const transition = workspacePaneCloseTransition(
    target,
    closingIdentity,
    options.workspacePaneRoute,
    options.presentationToken,
    options.selectedIdentity,
  )
  let close
  try {
    close = beginWorkspacePaneTabEntryClose(target, tabEntry)
  } catch (err) {
    terminalLog.warn('workspace pane tab close could not start', { err })
    finishWorkspacePaneRouteIntent(transition.presentationLease?.routeIntentId)
    return { kind: 'done', result: false }
  }
  if (!close.accepted) {
    finishWorkspacePaneRouteIntent(transition.presentationLease?.routeIntentId)
    return { kind: 'done', result: false }
  }
  return {
    kind: 'started',
    target,
    closingIdentity,
    wasActive: transition.wasActive,
    nextEntry: transition.nextEntry,
    presentationLease: transition.presentationLease,
    completion: close.completion,
  }
}

interface WorkspacePaneCloseTransition {
  wasActive: boolean
  nextEntry: WorkspacePaneTabEntry | null
  presentationLease: WorkspacePaneControllerPresentationLease | null
}

function workspacePaneCloseTransition(
  target: RepoWorkspaceTabModel,
  closingIdentity: string,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  presentationToken: PrimaryWindowPresentationToken | undefined,
  selectedIdentity: string | null | undefined = target.selectedIdentity,
): WorkspacePaneCloseTransition {
  const wasActive = selectedIdentity === closingIdentity
  if (!wasActive) return { wasActive: false, nextEntry: null, presentationLease: null }
  const openerIdentity = workspacePaneTabOpener(
    workspacePaneTabsTargetForModel(target),
    target.workspaceRuntimeId,
    closingIdentity,
  )
  const nextEntry = nextWorkspacePaneTabEntryAfterClose(target.tabEntries, closingIdentity, openerIdentity)
  const closingTab = target.tabs.find((candidate) => candidate.identity === closingIdentity) ?? null
  const nextTab = nextEntry
    ? (target.tabs.find((candidate) => candidate.identity === workspacePaneTabEntryIdentity(nextEntry)) ?? null)
    : null
  const presentationLease = closingTab
    ? beginWorkspacePaneCloseActiveTabPresentationLease({
        target,
        closingTab,
        nextTab,
        workspacePaneRoute,
        presentationToken,
      })
    : null
  return { wasActive, nextEntry, presentationLease }
}

function terminalBaseForPaneModel(target: RepoWorkspaceTabModel): TerminalSessionBase | null {
  if (!target.worktreePath) return null
  return workspacePaneTerminalBaseFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.branchName,
    rootPath: target.worktreePath,
  })
}

function openWorkspacePaneRuntimeCloseConfirm(
  workspaceId: string,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null,
): boolean {
  if (!request) return false
  const terminalBase = request.type === 'terminal' ? terminalBaseForRuntimeTabCloseTarget(request.target) : null
  if (request.type === 'terminal' && terminalBase && request.processName) {
    useTerminalActionDialogsStore.getState().openCloseConfirm({
      workspaceId,
      targetIdentity: request.identity,
      selectedIdentity,
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
  clearWorkspacePaneTabOpener(workspacePaneTabsTargetForModel(target), target.workspaceRuntimeId, identity)
}

function workspacePaneTabsTargetForModel(target: RepoWorkspaceTabModel): WorkspacePaneTabsTarget {
  if (target.paneTarget.kind === 'inactive') throw new Error('inactive workspace pane has no persistence target')
  return target.paneTarget
}

function resolveCloseWorkspacePaneTarget(
  input: Pick<CloseWorkspacePaneTabActionOptions, 'workspaceId' | 'workspacePaneRoute' | 'paneTarget' | 'worktreeHead'>,
): RepoWorkspaceTabModel | null {
  if (!input.workspaceId) return null
  return workspacePaneTabTargetForPaneTarget(input.paneTarget, input.workspacePaneRoute, input.worktreeHead)
}

async function runWorkspacePaneCloseTransition(
  presentationLease: WorkspacePaneControllerPresentationLease | null,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await operation()
  } finally {
    finishWorkspacePaneRouteIntent(presentationLease?.routeIntentId)
  }
}

async function completeWorkspacePaneTabLifecycle(completion: Promise<boolean>): Promise<boolean> {
  try {
    return await completion
  } catch (err) {
    terminalLog.warn('workspace pane tab close failed', { err })
    return false
  }
}
