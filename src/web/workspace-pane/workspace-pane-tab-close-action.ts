import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { isWorkspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import {
  isMaterializedWorkspacePaneRuntimeTab,
  workspacePaneTerminalBaseForTabModel,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { beginWorkspacePaneTabEntryClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  workspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  filesystemWorkspacePaneTargetLeaseIsCurrent,
  gitWorktreePaneTargetLease,
  workspaceRootPaneTargetLease,
  workspacePaneTabTargetBlocksInteraction,
  type WorkspacePaneTabTargetResolution,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { terminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneActionTargetFromLocation,
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
import { surfaceWorkspacePaneTabTargetUnavailable } from '#/web/workspace-pane/workspace-pane-tab-action-feedback.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

export interface CloseWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  location: WorkspacePaneLocation
  selectedIdentity?: string | null
  navigation: AppNavigationActions
  targetIdentity?: string
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

type WorkspacePaneTabCloseAuthoritySettlement = WorkspacePaneTabCloseOutcome | { kind: 'uncertain' }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const presentationEffects = createWorkspacePaneTabClosePresentationLease(options.presentationEffects)
  const ownedOptions = presentationEffects ? { ...options, presentationEffects } : options
  try {
    if (!ownedOptions.workspaceId) return await closeWorkspacePaneTabAction(ownedOptions)
    const coordinatorTarget = admitCloseWorkspacePaneTarget(
      resolveCloseWorkspacePaneTarget(ownedOptions, ownedOptions.workspacePaneRoute),
    )
    if (!coordinatorTarget?.location) {
      presentationEffects?.onAbandon()
      return false
    }
    return await runWorkspacePaneAction(workspacePaneActionTargetFromLocation(coordinatorTarget.location), () =>
      closeWorkspacePaneTabAction(ownedOptions),
    )
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

async function closeWorkspacePaneTabAction(options: CloseWorkspacePaneTabActionOptions): Promise<boolean> {
  try {
    const start = beginCloseWorkspacePaneTabAction(options)
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
    if (queueWorkspaceId !== coordinates.workspaceId || !runtimeFilesystemTargetIsCurrent(base.target)) {
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

function runtimeFilesystemTargetIsCurrent(target: TerminalSessionBase['target']): boolean {
  const paneTarget = workspacePaneTabsTargetFromRuntime(target)
  if (!paneTarget) return false
  return paneTarget.kind === 'workspace-root'
    ? filesystemWorkspacePaneTargetLeaseIsCurrent(
        workspaceRootPaneTargetLease(paneTarget.workspaceId, target.workspaceRuntimeId),
      )
    : filesystemWorkspacePaneTargetLeaseIsCurrent(
        gitWorktreePaneTargetLease(paneTarget.workspaceId, target.workspaceRuntimeId, paneTarget.worktreePath),
      )
}

async function confirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  if (!runtimeFilesystemTargetIsCurrent(options.confirmedTerminal.base.target)) {
    options.presentationEffects?.onAbandon()
    return false
  }
  const routeChanged =
    options.workspacePaneRoute !== undefined &&
    options.currentWorkspacePaneRoute !== undefined &&
    !sameWorkspacePaneRoute(options.workspacePaneRoute, options.currentWorkspacePaneRoute)
  const presentationEffects = routeChanged ? undefined : options.presentationEffects
  if (routeChanged) options.presentationEffects?.onAbandon()
  const { workspaceId, navigation, targetIdentity, confirmedTerminal } = options
  const confirmed: ConfirmedWorkspacePaneRuntimeTabClose = {
    type: 'terminal',
    sessionId: confirmedTerminal.terminalSessionId,
    target: confirmedTerminal.base,
  }
  const confirmedIdentity = targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed)
  const closeTargetResolution = workspaceId
    ? resolveCloseWorkspacePaneTarget(options, options.workspacePaneRoute)
    : { kind: 'missing' as const }
  const closeTarget = closeTargetResolution.kind === 'ready' ? closeTargetResolution.target : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) {
    presentationEffects?.onAbandon()
    return false
  }
  const transition = closeTarget
    ? prepareWorkspacePaneClosePresentation({
        target: closeTarget,
        closingIdentity: confirmedIdentity,
        workspacePaneRoute: options.currentWorkspacePaneRoute,
        selectedIdentity: options.selectedIdentity,
      })
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
    presentationEffects,
  })
}

function sameWorkspacePaneRoute(
  left: ParsedWorkspacePaneRoute | null | undefined,
  right: ParsedWorkspacePaneRoute | null | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right
  if (left === null || right === null || left.kind !== right.kind) return left === right
  if (left.kind === 'static') return right.kind === 'static' && left.tab === right.tab
  if (left.kind === 'terminal') return right.kind === 'terminal' && left.terminalSessionId === right.terminalSessionId
  return right.kind === 'invalid-static' && left.tabKey === right.tabKey
}

function beginCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): CloseWorkspacePaneTabActionStart {
  const { workspaceId, targetIdentity } = options
  const target = workspaceId
    ? admitCloseWorkspacePaneTarget(resolveCloseWorkspacePaneTarget(options, options.workspacePaneRoute))
    : null
  if (!target) return { kind: 'done', result: false }
  if (workspacePaneTabTargetBlocksInteraction(target)) return { kind: 'done', result: true }
  const tabEntry = targetIdentity
    ? (target.surfaceTabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === targetIdentity) ?? null)
    : target.selectedEntry
  if (!tabEntry) return { kind: 'done', result: false }
  const closingIdentity = workspacePaneTabEntryIdentity(tabEntry)
  const workspacePaneRoute = options.workspacePaneRoute
  const tab = target.tabs.find((candidate) => candidate.identity === closingIdentity) ?? null
  const runtimeTab = tab && isMaterializedWorkspacePaneRuntimeTab(tab) ? tab : null
  if (isWorkspacePaneRuntimeTabEntry(tabEntry) && !runtimeTab) {
    if (tab?.kind === 'runtime-placeholder') {
      surfaceWorkspacePaneTabCloseFeedback({
        kind: 'blocked-runtime-materialization',
        phase: tab.projectionPhase,
      })
    }
    return { kind: 'done', result: false }
  }
  const runtimeView = runtimeTab?.view
  if (runtimeView?.type === 'terminal') {
    const terminalBase = workspacePaneTerminalBaseForTabModel(target)
    if (!terminalBase) return { kind: 'done', result: false }
    const closeConfirm = workspacePaneRuntimeTabCloseConfirmRequest({
      type: runtimeView.type,
      identity: closingIdentity,
      sessionId: runtimeView.terminalSessionId,
      view: runtimeView,
      target: terminalBase,
    })
    if (!target.location) return { kind: 'done', result: false }
    if (
      openWorkspacePaneRuntimeCloseConfirm(
        target.location.workspaceId,
        target.location,
        closeConfirm,
        workspacePaneRoute,
        options.selectedIdentity ?? target.selectedIdentity,
        options.presentationEffects,
      )
    ) {
      return { kind: 'deferred' }
    }
  }

  const transition = prepareWorkspacePaneClosePresentation({
    target,
    closingIdentity,
    workspacePaneRoute,
    selectedIdentity: options.selectedIdentity,
  })
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

function admitCloseWorkspacePaneTarget(resolution: WorkspacePaneTabTargetResolution): WorkspacePaneTabModel | null {
  if (resolution.kind === 'unavailable') {
    surfaceWorkspacePaneTabTargetUnavailable(resolution.reason)
    return null
  }
  return resolution.kind === 'ready' ? resolution.target : null
}

function openWorkspacePaneRuntimeCloseConfirm(
  workspaceId: WorkspaceId,
  location: WorkspacePaneLocation,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null,
  presentationEffects: WorkspacePaneTabClosePresentationEffects | undefined,
): boolean {
  if (!request) return false
  if (request.processName) {
    terminalActionDialogsStore.getState().openCloseConfirm({
      workspaceId,
      location,
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
    const presentation = input.target
      ? input.transition
        ? await presentCommittedWorkspacePaneTabClose({
            target: input.target,
            closingIdentity: input.closingIdentity,
            transition: input.transition,
            navigation: input.navigation,
          })
        : { kind: 'superseded' as const }
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
