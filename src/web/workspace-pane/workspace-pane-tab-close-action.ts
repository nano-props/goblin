import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import { terminalExecutionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  isWorkspacePaneRuntimeTab,
  nextWorkspacePaneTabEntryAfterClose,
  workspacePaneTerminalBaseForTabModel,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneControllerCloseBackTargetOutcome,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneControllerRouteForEntry,
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
  resolveRetiredTerminalWorkspacePaneTabTarget,
  resolveWorkspacePaneTabTargetForPaneTarget,
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
  type WorkspacePaneTargetCurrentness,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  clearWorkspacePaneTabOpener,
  consumeWorkspacePaneTabOpener,
  workspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
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
import { terminalLog } from '#/web/logger.ts'
import type { PrimaryWindowNavigationIntent } from '#/web/primary-window-navigation-lifecycle.ts'
import type { TerminalRetirementPresentationContext } from '#/shared/terminal-types.ts'

export interface CloseWorkspacePaneTabActionOptions {
  workspaceId: WorkspaceId | null
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  runtimeView?: WorkspacePaneRuntimeTabSummary
  selectedIdentity?: string | null
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
  currentWorkspacePaneRoute: ParsedWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalWorkspacePaneTabClose
}

interface RetiredTerminalWorkspacePaneTabPresentationCaptureOptions extends Pick<
  CloseWorkspacePaneTabActionOptions,
  'workspacePaneRoute' | 'routeTarget'
> {
  terminalSessionId: string
  terminalBase: TerminalSessionBase
  retirementPresentation: TerminalRetirementPresentationContext
}

export interface RetiredTerminalWorkspacePaneTabPresentationPlan {
  readonly terminalSessionId: string
  readonly target: WorkspacePaneTabModel
  readonly closingEntry: WorkspacePaneTabEntry
  readonly nextEntry: WorkspacePaneTabEntry | null
  readonly sourceRoute: Extract<ParsedWorkspacePaneRoute, { kind: 'terminal' }>
  readonly openerIdentity: string | null
}

export type RetiredTerminalWorkspacePaneTabPresentationCommitOutcome =
  { kind: 'committed' } | { kind: 'retry' } | { kind: 'pending' } | { kind: 'abandoned' }

type CloseWorkspacePaneTabActionStart =
  | { kind: 'done'; result: boolean }
  | {
      kind: 'started'
      target: WorkspacePaneTabModel
      closingIdentity: string
      wasActive: boolean
      nextEntry: WorkspacePaneTabEntry | null
      presentationLease: WorkspacePaneControllerPresentationLease | null
      completion: Promise<boolean>
    }

type CloseWorkspacePaneTabSelection =
  { kind: 'observed-route'; route: ParsedWorkspacePaneRoute | null | undefined } | { kind: 'current' }

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
  if (!options.workspaceId) return await closeWorkspacePaneTabAction(options, selection)
  const coordinatorTarget = resolveCloseWorkspacePaneTarget(
    options,
    selection.kind === 'current' ? undefined : selection.route,
  )
  if (!coordinatorTarget) return false
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      workspaceId: coordinatorTarget.workspaceId,
      workspaceRuntimeId: coordinatorTarget.workspaceRuntimeId,
      branchName: coordinatorTarget.branchName,
      worktreePath: coordinatorTarget.worktreePath,
    }),
    () => closeWorkspacePaneTabAction(options, selection),
  )
}

async function closeWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
  selection: CloseWorkspacePaneTabSelection,
): Promise<boolean> {
  const start = beginCloseWorkspacePaneTabAction(options, selection)
  if (start.kind === 'done') return start.result
  return await runWorkspacePaneCloseTransition(start.presentationLease, async () => {
    if (!(await completeWorkspacePaneTabLifecycle(start.completion))) return false
    completeWorkspacePaneTabClose(start.target, start.closingIdentity)
    await completeCommittedWorkspacePaneClosePresentation(start.target, start, options.navigation)
    return true
  })
}

/**
 * Captures every close-back fact synchronously from the complete before
 * projection. A caller may retain this immutable plan while another
 * presentation intent settles; it must never re-derive the destination from
 * the later after projection.
 */
export function captureRetiredTerminalWorkspacePaneTabPresentationPlan(
  options: RetiredTerminalWorkspacePaneTabPresentationCaptureOptions,
): RetiredTerminalWorkspacePaneTabPresentationPlan | null {
  const coordinates = terminalExecutionCoordinates(options.terminalBase.target)
  if (options.routeTarget.workspaceId !== coordinates.workspaceId) return null
  const closingIdentity = workspacePaneRuntimeTabConfirmedCloseIdentity({
    type: 'terminal',
    sessionId: options.terminalSessionId,
    target: options.terminalBase,
  })
  const resolution = resolveRetiredTerminalWorkspacePaneTabTarget({
    routeTarget: options.routeTarget,
    workspacePaneRoute: options.workspacePaneRoute ?? null,
    terminalBase: options.terminalBase,
    retirementPresentation: options.retirementPresentation,
  })
  const sourceRoute = options.workspacePaneRoute
  if (
    resolution.kind !== 'ready' ||
    sourceRoute?.kind !== 'terminal' ||
    sourceRoute.terminalSessionId !== options.terminalSessionId ||
    resolution.target.selectedIdentity !== closingIdentity
  ) {
    return null
  }
  const target = resolution.target
  const transition = captureWorkspacePaneCloseTransition(target, closingIdentity, target.selectedIdentity)
  if (!transition.wasActive || !transition.closingEntry) return null
  return {
    terminalSessionId: options.terminalSessionId,
    target,
    closingEntry: transition.closingEntry,
    nextEntry: transition.nextEntry,
    sourceRoute,
    openerIdentity: transition.openerIdentity,
  }
}

export function settleRetiredTerminalWorkspacePaneTabPresentationPlan(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
): void {
  if (plan.openerIdentity === null) return
  consumeWorkspacePaneTabOpener(
    workspacePaneTabsTargetForModel(plan.target),
    plan.target.workspaceRuntimeId,
    workspacePaneTabEntryIdentity(plan.closingEntry),
    plan.openerIdentity,
  )
}

export function commitRetiredTerminalWorkspacePaneTabPresentationPlan(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
  navigation: PrimaryWindowNavigationActions,
  navigationIntent: PrimaryWindowNavigationIntent,
): Promise<RetiredTerminalWorkspacePaneTabPresentationCommitOutcome> {
  const { target } = plan
  const queueTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  })
  return runWorkspacePaneAction(queueTarget, async () => {
    if (!navigationIntent.isCurrent()) return { kind: 'abandoned' }
    const currentness = retiredTerminalWorkspacePaneTabPresentationCurrentness(plan)
    if (currentness !== 'current') return { kind: currentness === 'pending' ? 'pending' : 'abandoned' }
    const presentationLease = beginWorkspacePaneCloseActiveTabPresentationLease({
      target,
      closingEntry: plan.closingEntry,
      nextEntry: plan.nextEntry,
      workspacePaneRoute: plan.sourceRoute,
      navigationIntent,
      presentationCurrentness: () => retiredTerminalWorkspacePaneTabPresentationCurrentness(plan),
    })
    if (!presentationLease) return { kind: 'abandoned' }
    return await runWorkspacePaneCloseTransition(presentationLease, async () => {
      return await commitWorkspacePaneControllerCloseBackTargetOutcome(presentationLease, navigation)
    })
  })
}

function retiredTerminalWorkspacePaneTabPresentationCurrentness(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
): WorkspacePaneTargetCurrentness {
  const target = plan.target
  const resolution = resolveWorkspacePaneTabTargetForPaneTarget({
    routeTarget: workspacePaneRouteTargetForModel(target),
    paneTarget: workspacePaneTabsTargetForModel(target),
    workspaceRuntimeId: target.workspaceRuntimeId,
    workspacePaneRoute: plan.sourceRoute,
    worktreeHead: target.branchName ? { kind: 'branch', branchName: target.branchName } : undefined,
  })
  if (resolution.kind !== 'ready') return resolution.kind
  return retiredTerminalCloseBackDestinationIsCurrent(plan, resolution.target) ? 'current' : 'stale'
}

function retiredTerminalCloseBackDestinationIsCurrent(
  plan: RetiredTerminalWorkspacePaneTabPresentationPlan,
  currentTarget: WorkspacePaneTabModel,
): boolean {
  const nextIdentity = plan.nextEntry ? workspacePaneTabEntryIdentity(plan.nextEntry) : null
  return (
    nextIdentity === null ||
    currentTarget.tabEntries.some((entry) => workspacePaneTabEntryIdentity(entry) === nextIdentity)
  )
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const base = options.confirmedTerminal.base
  const coordinates = terminalExecutionCoordinates(base.target)
  const queueWorkspaceId = options.workspaceId ?? coordinates.workspaceId
  if (queueWorkspaceId !== coordinates.workspaceId) return false
  const queueTarget = workspacePaneActionTargetFromFilesystemTarget(base.target)
  return await runWorkspacePaneAction(queueTarget, () => confirmCloseTerminalWorkspacePaneTabAction(options))
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
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) return false
  const transition = closeTarget
    ? workspacePaneCloseTransition(
        closeTarget,
        confirmedIdentity,
        options.currentWorkspacePaneRoute,
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
    if (transition && closeTarget) {
      await completeCommittedWorkspacePaneClosePresentation(closeTarget, transition, navigation)
    }
    return true
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
        workspacePaneRouteTargetForModel(target),
        closeConfirm,
        workspacePaneRoute,
        options.selectedIdentity ?? target.selectedIdentity,
      )
    ) {
      return { kind: 'done', result: true }
    }
  }

  const transition = workspacePaneCloseTransition(target, closingIdentity, workspacePaneRoute, options.selectedIdentity)
  let close
  try {
    close = beginWorkspacePaneTabEntryClose(target, tabEntry)
  } catch (err) {
    terminalLog.warn('workspace pane tab close could not start', { err })
    abandonWorkspacePaneCloseTransition(transition.presentationLease)
    return { kind: 'done', result: false }
  }
  if (!close.accepted) {
    abandonWorkspacePaneCloseTransition(transition.presentationLease)
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
  closingEntry: WorkspacePaneTabEntry | null
  nextEntry: WorkspacePaneTabEntry | null
  openerIdentity: string | null
  presentationLease: WorkspacePaneControllerPresentationLease | null
}

function workspacePaneCloseTransition(
  target: WorkspacePaneTabModel,
  closingIdentity: string,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null | undefined = target.selectedIdentity,
): WorkspacePaneCloseTransition {
  const captured = captureWorkspacePaneCloseTransition(target, closingIdentity, selectedIdentity)
  if (!captured.wasActive) return { ...captured, presentationLease: null }
  const { closingEntry, nextEntry } = captured
  const presentationLease = closingEntry
    ? beginWorkspacePaneCloseActiveTabPresentationLease({
        target,
        closingEntry,
        nextEntry,
        workspacePaneRoute,
      })
    : null
  return { ...captured, presentationLease }
}

function captureWorkspacePaneCloseTransition(
  target: WorkspacePaneTabModel,
  closingIdentity: string,
  selectedIdentity: string | null | undefined,
): Pick<WorkspacePaneCloseTransition, 'wasActive' | 'closingEntry' | 'nextEntry' | 'openerIdentity'> {
  const wasActive = selectedIdentity === closingIdentity
  if (!wasActive) return { wasActive: false, closingEntry: null, nextEntry: null, openerIdentity: null }
  const openerIdentity = workspacePaneTabOpener(
    workspacePaneTabsTargetForModel(target),
    target.workspaceRuntimeId,
    closingIdentity,
  )
  const nextEntry = nextWorkspacePaneTabEntryAfterClose(target.tabEntries, closingIdentity, openerIdentity)
  const closingEntry =
    target.tabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === closingIdentity) ?? null
  return { wasActive, closingEntry, nextEntry, openerIdentity }
}

function terminalBaseForPaneModel(target: WorkspacePaneTabModel): TerminalSessionBase | null {
  return workspacePaneTerminalBaseForTabModel(target)
}

function openWorkspacePaneRuntimeCloseConfirm(
  workspaceId: WorkspaceId,
  routeTarget: WorkspacePaneTabsTarget,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null,
): boolean {
  if (!request) return false
  const terminalBase = request.type === 'terminal' ? terminalBaseForRuntimeTabCloseTarget(request.target) : null
  if (request.type === 'terminal' && terminalBase && request.processName) {
    useTerminalActionDialogsStore.getState().openCloseConfirm({
      workspaceId,
      routeTarget,
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

function completeWorkspacePaneTabClose(target: WorkspacePaneTabModel, identity: string): void {
  clearWorkspacePaneTabOpener(workspacePaneTabsTargetForModel(target), target.workspaceRuntimeId, identity)
}

function workspacePaneTabsTargetForModel(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.paneTarget.kind === 'inactive') throw new Error('inactive workspace pane has no persistence target')
  return target.paneTarget
}

function workspacePaneRouteTargetForModel(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.routeTarget.kind === 'inactive') throw new Error('inactive workspace pane has no route target')
  return target.routeTarget
}

function resolveCloseWorkspacePaneTarget(
  input: Pick<
    CloseWorkspacePaneTabActionOptions,
    'workspaceId' | 'workspacePaneRoute' | 'routeTarget' | 'paneTarget' | 'worktreeHead'
  >,
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

async function runWorkspacePaneCloseTransition<T>(
  presentationLease: WorkspacePaneControllerPresentationLease | null,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } finally {
    abandonWorkspacePaneCloseTransition(presentationLease)
  }
}

function abandonWorkspacePaneCloseTransition(presentationLease: WorkspacePaneControllerPresentationLease | null): void {
  presentationLease?.focusEffects?.onAbandon()
  presentationLease?.navigationIntent.release()
}

async function completeWorkspacePaneTabLifecycle(completion: Promise<boolean>): Promise<boolean> {
  try {
    return await completion
  } catch (err) {
    terminalLog.warn('workspace pane tab close failed', { err })
    return false
  }
}

async function reconcilePresentationAfterCommittedWorkspacePaneClose(operation: () => Promise<boolean>): Promise<void> {
  try {
    await operation()
  } catch (err) {
    // The tab close is already authoritative. Route reconciliation is a
    // separate presentation effect and cannot roll that data mutation back.
    terminalLog.warn('workspace pane tab closed but its next presentation failed', { err })
  }
}

async function completeCommittedWorkspacePaneClosePresentation(
  target: WorkspacePaneTabModel,
  transition: Pick<WorkspacePaneCloseTransition, 'wasActive' | 'nextEntry' | 'presentationLease'>,
  navigation: PrimaryWindowNavigationActions,
): Promise<void> {
  if (!transition.wasActive) return
  if (!workspacePaneTabControllerTargetIsCurrent(target)) return
  if (!transition.presentationLease) {
    const nextEntry = transition.nextEntry
    if (nextEntry) {
      await reconcilePresentationAfterCommittedWorkspacePaneClose(() =>
        selectWorkspacePaneControllerTabEntry(target, nextEntry, navigation),
      )
    }
    return
  }
  const presentationLease = transition.presentationLease
  await reconcilePresentationAfterCommittedWorkspacePaneClose(() =>
    commitWorkspacePaneControllerCloseBackTarget(presentationLease, navigation),
  )
}
