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
import { nextWorkspacePaneTabEntryAfterClose } from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneControllerRetirementCloseBackTarget,
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
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { terminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
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
import { captureUnownedAppNavigationGeneration, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { createWorkspacePaneTabClosePresentationLease } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

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

export interface RetiredTerminalWorkspacePaneTabPresentationOptions {
  workspaceId: WorkspaceId
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  navigation: AppNavigationActions
  terminalSessionId: string
  tabsBeforeRetirement: WorkspacePaneTabEntry[]
}

type CloseWorkspacePaneTabActionStart =
  | { kind: 'done'; result: boolean }
  | { kind: 'deferred' }
  | {
      kind: 'started'
      target: WorkspacePaneTabModel
      closingIdentity: string
      transition: WorkspacePaneCloseTransition
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
    return await runWorkspacePaneTabClosePresentationEffects(options.presentationEffects, () =>
      runWorkspacePaneCloseTransition(start.transition.presentationLease, async () => {
        if (!(await completeWorkspacePaneTabLifecycle(start.completion))) return false
        completeWorkspacePaneTabClose(start.target, start.closingIdentity)
        await completeCommittedWorkspacePaneClosePresentation(start.target, start.transition, options.navigation)
        return true
      }),
    )
  } catch (error) {
    options.presentationEffects?.onAbandon()
    throw error
  }
}

/**
 * Completes only the presentation half of a terminal retirement. The server
 * has already committed the resource transition, so this captures the exact
 * close-back plan from the still-complete before projection and never issues a
 * second terminal close.
 */
export function dispatchRetiredTerminalWorkspacePaneTabPresentationAction(
  options: RetiredTerminalWorkspacePaneTabPresentationOptions,
): Promise<boolean> {
  if (
    options.workspacePaneRoute?.kind !== 'terminal' ||
    options.workspacePaneRoute.terminalSessionId !== options.terminalSessionId
  ) {
    return Promise.resolve(false)
  }
  const target = resolveCloseWorkspacePaneTarget(options, options.workspacePaneRoute)
  if (!target) return Promise.resolve(false)
  const closingIdentity = workspacePaneTabEntryIdentity({
    type: 'terminal',
    runtimeSessionId: options.terminalSessionId,
  })
  const navigationGeneration = captureUnownedAppNavigationGeneration()
  if (navigationGeneration === null) {
    completeWorkspacePaneTabClose(target, closingIdentity)
    return Promise.resolve(false)
  }
  const transition = workspacePaneCloseTransition(
    target,
    closingIdentity,
    options.workspacePaneRoute,
    closingIdentity,
    navigationGeneration,
    options.tabsBeforeRetirement,
  )
  completeWorkspacePaneTabClose(target, closingIdentity)
  const presentationLease = transition.presentationLease
  if (!presentationLease) return Promise.resolve(false)
  const queueTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  })
  return runWorkspacePaneAction(queueTarget, async () => {
    return await runWorkspacePaneCloseTransition(presentationLease, async () => {
      if (!workspacePaneTabControllerTargetIsCurrent(target)) return false
      await reconcilePresentationAfterCommittedWorkspacePaneClose(() =>
        commitWorkspacePaneControllerRetirementCloseBackTarget(presentationLease, options.navigation),
      )
      return true
    })
  })
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
    ? workspacePaneCloseTransition(
        closeTarget,
        confirmedIdentity,
        options.currentWorkspacePaneRoute,
        options.selectedIdentity,
      )
    : null
  return await runWorkspacePaneTabClosePresentationEffects(options.presentationEffects, () =>
    runWorkspacePaneCloseTransition(transition?.presentationLease ?? null, async () => {
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
    }),
  )
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
        workspacePaneRouteTargetForModel(target),
        closeConfirm,
        workspacePaneRoute,
        options.selectedIdentity ?? target.selectedIdentity,
        options.presentationEffects,
      )
    ) {
      return { kind: 'deferred' }
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
    transition,
    completion: close.completion,
  }
}

interface WorkspacePaneCloseTransition {
  wasActive: boolean
  nextEntry: WorkspacePaneTabEntry | null
  presentationLease: WorkspacePaneControllerPresentationLease | null
}

function workspacePaneCloseTransition(
  target: WorkspacePaneTabModel,
  closingIdentity: string,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
  selectedIdentity: string | null | undefined = target.selectedIdentity,
  navigationGeneration?: AppNavigationGeneration,
  tabEntries: readonly WorkspacePaneTabEntry[] = target.tabEntries,
): WorkspacePaneCloseTransition {
  const wasActive = selectedIdentity === closingIdentity
  if (!wasActive) return { wasActive: false, nextEntry: null, presentationLease: null }
  const openerIdentity = workspacePaneTabOpener(
    workspacePaneTabsTargetForModel(target),
    target.workspaceRuntimeId,
    closingIdentity,
  )
  const nextEntry = nextWorkspacePaneTabEntryAfterClose(tabEntries, closingIdentity, openerIdentity)
  const closingEntry = tabEntries.find((entry) => workspacePaneTabEntryIdentity(entry) === closingIdentity)
  const presentationLease = closingEntry
    ? beginWorkspacePaneCloseActiveTabPresentationLease({
        target,
        closingEntry,
        nextEntry,
        workspacePaneRoute,
        ...(navigationGeneration === undefined ? {} : { navigationGeneration }),
      })
    : null
  return { wasActive, nextEntry, presentationLease }
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
  const terminalBase = request.type === 'terminal' ? terminalBaseForRuntimeTabCloseTarget(request.target) : null
  if (request.type === 'terminal' && terminalBase && request.processName) {
    terminalActionDialogsStore.getState().openCloseConfirm({
      workspaceId,
      routeTarget,
      targetIdentity: request.identity,
      selectedIdentity,
      workspacePaneRoute,
      terminalSessionId: request.sessionId,
      terminalBase,
      processName: request.processName,
      ...(presentationEffects ? { presentationEffects } : {}),
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

async function runWorkspacePaneTabClosePresentationEffects(
  presentationEffects: WorkspacePaneTabClosePresentationEffects | undefined,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  try {
    const result = await operation()
    if (result) presentationEffects?.onCommit()
    else presentationEffects?.onAbandon()
    return result
  } catch (error) {
    presentationEffects?.onAbandon()
    throw error
  }
}

async function runWorkspacePaneCloseTransition(
  presentationLease: WorkspacePaneControllerPresentationLease | null,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await operation()
  } finally {
    abandonWorkspacePaneCloseTransition(presentationLease)
  }
}

function abandonWorkspacePaneCloseTransition(presentationLease: WorkspacePaneControllerPresentationLease | null): void {
  presentationLease?.focusEffects?.onAbandon()
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
  transition: WorkspacePaneCloseTransition,
  navigation: AppNavigationActions,
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
