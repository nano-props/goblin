import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import {
  isWorkspacePaneRuntimeTab,
  workspacePaneTerminalBaseForTabModel,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { workspacePaneControllerRouteForEntry } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import { beginWorkspacePaneTabEntryClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { terminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionTargetFromFilesystemTarget,
  runWorkspacePaneAction,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { terminalLog } from '#/web/logger.ts'
import {
  abandonWorkspacePaneClosePresentation,
  createWorkspacePaneTabClosePresentationLease,
  prepareWorkspacePaneClosePresentation,
  presentCommittedWorkspacePaneTabClose,
  surfaceWorkspacePaneTabCloseFeedback,
  type WorkspacePaneCloseTransition,
  type WorkspacePaneTabClosePresentationEffects,
} from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'
import {
  resolveCloseWorkspacePaneTarget,
  workspacePaneRouteTargetForClose,
} from '#/web/workspace-pane/workspace-pane-tab-close-target.ts'
import type { WorkspacePaneTabCloseOutcome } from '#/web/workspace-pane/workspace-pane-tab-close-outcome.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

export interface CloseWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  runtimeView?: WorkspacePaneRuntimeTabSummary
  selectedIdentity?: string | null
  navigation: AppNavigationActions
  targetIdentity?: string
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
  presentationEffects?: WorkspacePaneTabClosePresentationEffects
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
  | { kind: 'deferred' }
  | {
      kind: 'started'
      target: WorkspacePaneTabModel
      closingIdentity: string
      transition: WorkspacePaneCloseTransition
      completion: Promise<WorkspacePaneTabCloseOutcome>
    }

type CloseWorkspacePaneTabSelection =
  { kind: 'observed-route'; route: ParsedWorkspacePaneRoute | null | undefined } | { kind: 'current' }

type WorkspacePaneTabCloseAuthoritySettlement = WorkspacePaneTabCloseOutcome | { kind: 'uncertain' }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  return await dispatchCloseWorkspacePaneTabSelection(options, {
    kind: 'observed-route',
    route: options.workspacePaneRoute,
  })
}

export async function dispatchCloseCurrentWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  return await dispatchCloseWorkspacePaneTabSelection(options, { kind: 'current' })
}

async function dispatchCloseWorkspacePaneTabSelection(
  options: CloseWorkspacePaneTabActionOptions,
  selection: CloseWorkspacePaneTabSelection,
): Promise<boolean> {
  const presentationEffects = createWorkspacePaneTabClosePresentationLease(options.presentationEffects)
  const ownedOptions = presentationEffects ? { ...options, presentationEffects } : options
  try {
    if (!ownedOptions.workspaceId) return await closeWorkspacePaneTabAction(ownedOptions, selection)
    const coordinatorTarget = resolveCloseWorkspacePaneTarget(
      ownedOptions,
      selection.kind === 'current' ? undefined : selection.route,
    )
    if (!coordinatorTarget) {
      presentationEffects?.onAbandon()
      return false
    }
    return await runWorkspacePaneAction(
      workspacePaneActionTargetFromCoordinates({
        workspaceId: coordinatorTarget.workspaceId,
        workspaceRuntimeId: coordinatorTarget.workspaceRuntimeId,
        branchName: coordinatorTarget.branchName,
        worktreePath: coordinatorTarget.worktreePath,
      }),
      () => closeWorkspacePaneTabAction(ownedOptions, selection),
    )
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

async function closeWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
  selection: CloseWorkspacePaneTabSelection,
): Promise<boolean> {
  try {
    const start = beginCloseWorkspacePaneTabAction(options, selection)
    if (start.kind === 'deferred') return true
    if (start.kind === 'done') {
      options.presentationEffects?.onAbandon()
      return start.result
    }
    return await completeWorkspacePaneTabClose({
      completion: start.completion,
      target: start.target,
      closingIdentity: start.closingIdentity,
      transition: start.transition,
      navigation: options.navigation,
      presentationEffects: options.presentationEffects,
    })
  } catch (error) {
    options.presentationEffects?.onAbandon()
    throw error
  }
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const presentationEffects = createWorkspacePaneTabClosePresentationLease(options.presentationEffects)
  const ownedOptions = presentationEffects ? { ...options, presentationEffects } : options
  try {
    const base = ownedOptions.confirmedTerminal.base
    const coordinates = terminalExecutionCoordinates(base.target)
    const queueWorkspaceId = ownedOptions.workspaceId ?? coordinates.workspaceId
    if (queueWorkspaceId !== coordinates.workspaceId) {
      presentationEffects?.onAbandon()
      return false
    }
    const queueTarget = workspacePaneActionTargetFromFilesystemTarget(base.target)
    return await runWorkspacePaneAction(queueTarget, () => confirmCloseTerminalWorkspacePaneTabAction(ownedOptions))
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
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
  const closeTarget = workspaceId ? resolveCloseWorkspacePaneTarget(options, options.workspacePaneRoute) : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) {
    options.presentationEffects?.onAbandon()
    return false
  }
  const transition = closeTarget
    ? prepareWorkspacePaneClosePresentation(
        closeTarget,
        confirmedIdentity,
        options.currentWorkspacePaneRoute,
        options.selectedIdentity,
      )
    : null
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  const completion = closeContext
    ? confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext)
    : Promise.resolve<WorkspacePaneTabCloseOutcome>({ kind: 'not-committed', message: null })
  return await completeWorkspacePaneTabClose({
    completion,
    target: closeTarget,
    closingIdentity: confirmedIdentity,
    transition,
    navigation,
    presentationEffects: options.presentationEffects,
  })
}

function beginCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
  selection: CloseWorkspacePaneTabSelection,
): CloseWorkspacePaneTabActionStart {
  const { workspaceId, targetIdentity } = options
  const skipRuntimeCloseConfirm = options.skipRuntimeCloseConfirm ?? options.skipTerminalCloseConfirm ?? false
  const target = workspaceId
    ? resolveCloseWorkspacePaneTarget(options, selection.kind === 'current' ? undefined : selection.route)
    : null
  if (!target) return { kind: 'done', result: false }
  if (workspacePaneTabTargetBlocksInteraction(target)) return { kind: 'done', result: true }
  const tabEntry = targetIdentity
    ? (target.tabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === targetIdentity) ?? null)
    : target.selectedEntry
  if (!tabEntry) return { kind: 'done', result: false }
  const closingIdentity = workspacePaneTabEntryIdentity(tabEntry)
  const workspacePaneRoute =
    selection.kind === 'current' ? workspacePaneControllerRouteForEntry(tabEntry) : selection.route
  const tab = target.tabs.find((candidate) => candidate.identity === closingIdentity) ?? null
  const runtimeView = tab && isWorkspacePaneRuntimeTab(tab) ? tab.view : options.runtimeView
  if (!skipRuntimeCloseConfirm && runtimeView?.type === 'terminal') {
    const terminalBase = workspacePaneTerminalBaseForTabModel(target)
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
        workspacePaneRouteTargetForClose(target),
        closeConfirm,
        workspacePaneRoute,
        options.selectedIdentity ?? target.selectedIdentity,
        options.presentationEffects,
      )
    ) {
      return { kind: 'deferred' }
    }
  }

  const transition = prepareWorkspacePaneClosePresentation(
    target,
    closingIdentity,
    workspacePaneRoute,
    options.selectedIdentity,
  )
  let close
  try {
    close = beginWorkspacePaneTabEntryClose(target, tabEntry)
  } catch (err) {
    terminalLog.warn('workspace pane tab close could not start', { err })
    abandonWorkspacePaneClosePresentation(transition)
    return { kind: 'done', result: false }
  }
  if (!close.accepted) {
    abandonWorkspacePaneClosePresentation(transition)
    return { kind: 'done', result: false }
  }
  return {
    kind: 'started',
    target,
    closingIdentity,
    transition,
    completion: close.completion,
  }
}

function openWorkspacePaneRuntimeCloseConfirm(
  workspaceId: WorkspaceId,
  routeTarget: WorkspacePaneTabsTarget,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null,
  presentationEffects: WorkspacePaneTabClosePresentationEffects | undefined,
): boolean {
  if (!request) return false
  if (request.processName) {
    terminalActionDialogsStore.getState().openCloseConfirm({
      workspaceId,
      routeTarget,
      targetIdentity: request.identity,
      selectedIdentity,
      workspacePaneRoute,
      terminalSessionId: request.sessionId,
      terminalBase: request.target,
      processName: request.processName,
      ...(presentationEffects ? { presentationEffects } : {}),
    })
    return true
  }
  return false
}

async function completeWorkspacePaneTabClose(input: {
  completion: Promise<WorkspacePaneTabCloseOutcome>
  target: WorkspacePaneTabModel | null
  closingIdentity: string
  transition: WorkspacePaneCloseTransition | null
  navigation: AppNavigationActions
  presentationEffects: WorkspacePaneTabClosePresentationEffects | undefined
}): Promise<boolean> {
  try {
    const authority = await settleWorkspacePaneTabCloseAuthority(input.completion)
    if (authority.kind !== 'committed') {
      input.presentationEffects?.onAbandon()
      return false
    }
    if (authority.projection === 'failed') {
      surfaceWorkspacePaneTabCloseFeedback({ kind: 'committed-projection-failed' })
    } else if (authority.projection === 'superseded') {
      input.presentationEffects?.onAbandon()
      return true
    }
    const presentation =
      input.target && input.transition
        ? await presentCommittedWorkspacePaneTabClose({
            target: input.target,
            closingIdentity: input.closingIdentity,
            transition: input.transition,
            navigation: input.navigation,
          })
        : { kind: 'settled' as const }
    if (presentation.kind === 'settled') input.presentationEffects?.onCommit()
    else input.presentationEffects?.onAbandon()
    return true
  } catch (error) {
    input.presentationEffects?.onAbandon()
    throw error
  } finally {
    abandonWorkspacePaneClosePresentation(input.transition)
  }
}

async function settleWorkspacePaneTabCloseAuthority(
  completion: Promise<WorkspacePaneTabCloseOutcome>,
): Promise<WorkspacePaneTabCloseAuthoritySettlement> {
  try {
    const outcome = await completion
    if (outcome.kind === 'not-committed' && outcome.message) {
      surfaceWorkspacePaneTabCloseFeedback({ kind: 'failed-before-commit', message: outcome.message })
    }
    return outcome
  } catch (error) {
    terminalLog.warn('workspace pane tab close failed', { err: error })
    if (error instanceof ClientRealtimeRequestError && error.delivery === 'indeterminate') {
      surfaceWorkspacePaneTabCloseFeedback({ kind: 'outcome-uncertain' })
      return { kind: 'uncertain' }
    }
    surfaceWorkspacePaneTabCloseFeedback({ kind: 'request-failed' })
    return { kind: 'not-committed', message: null }
  }
}
