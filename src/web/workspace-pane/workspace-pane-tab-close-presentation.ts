import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { workspacePaneTabEntryIdentity, type WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { nextWorkspacePaneTabEntryAfterClose } from '#/web/workspace-pane/workspace-pane-tab-navigation.ts'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneControllerRetirementCloseBackTarget,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneControllerPresentationLease,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  resolveCloseWorkspacePaneTarget,
  workspacePaneTabsTargetForClose,
} from '#/web/workspace-pane/workspace-pane-tab-close-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  runWorkspacePaneAction,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { captureUnownedAppNavigationGeneration, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { terminalLog } from '#/web/logger.ts'
import { translate } from '#/web/stores/i18n-vue.ts'
import { toast } from 'vue-sonner'

export interface WorkspacePaneTabClosePresentationEffects {
  onCommit(): void
  onAbandon(): void
}

export interface RetiredTerminalWorkspacePaneTabPresentationOptions {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
  navigation: AppNavigationActions
  terminalSessionId: string
  tabsBeforeRetirement: WorkspacePaneTabEntry[]
}

export interface WorkspacePaneCloseTransition {
  wasActive: boolean
  nextEntry: WorkspacePaneTabEntry | null
  presentationLease: WorkspacePaneControllerPresentationLease | null
}

type WorkspacePaneClosePresentationResult = { kind: 'settled' } | { kind: 'superseded' } | { kind: 'failed' }

type WorkspacePaneTabCloseFeedback =
  | { kind: 'committed-projection-failed' }
  | { kind: 'failed-before-commit'; message: string }
  | { kind: 'outcome-uncertain' }
  | { kind: 'request-failed' }
  | { kind: 'presentation-failed' }

const WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS = {
  invalidArguments: 'error.invalid-arguments',
  runtimeStale: 'error.workspace-runtime-stale',
  worktreeRemovalInProgress: 'error.worktree-removal-in-progress',
  fallback: 'error.workspace-operation-failed',
} as const

export function createWorkspacePaneTabClosePresentationLease(
  effects: WorkspacePaneTabClosePresentationEffects | null | undefined,
): WorkspacePaneTabClosePresentationEffects | null {
  if (!effects) return null
  let settled = false
  return {
    onCommit() {
      if (settled) return
      settled = true
      effects.onCommit()
    },
    onAbandon() {
      if (settled) return
      settled = true
      effects.onAbandon()
    },
  }
}

export function prepareWorkspacePaneClosePresentation(
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
    workspacePaneTabsTargetForClose(target),
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

export function abandonWorkspacePaneClosePresentation(transition: WorkspacePaneCloseTransition | null): void {
  transition?.presentationLease?.focusEffects?.onAbandon()
}

export async function presentCommittedWorkspacePaneTabClose(input: {
  target: WorkspacePaneTabModel
  closingIdentity: string
  transition: WorkspacePaneCloseTransition
  navigation: AppNavigationActions
}): Promise<WorkspacePaneClosePresentationResult> {
  clearWorkspacePaneTabOpener(
    workspacePaneTabsTargetForClose(input.target),
    input.target.workspaceRuntimeId,
    input.closingIdentity,
  )
  const result = await reconcileCommittedWorkspacePaneClosePresentation({
    target: input.target,
    transition: input.transition,
    navigation: input.navigation,
  })
  if (result.kind === 'failed') surfaceWorkspacePaneTabCloseFeedback({ kind: 'presentation-failed' })
  return result
}

export function surfaceWorkspacePaneTabCloseFeedback(feedback: WorkspacePaneTabCloseFeedback): void {
  switch (feedback.kind) {
    case 'committed-projection-failed':
    case 'presentation-failed': {
      const messageKey = 'error.workspace-tabs-committed-projection-failed'
      toast.warning(translate(messageKey), { id: 'workspace-pane-tab-close-projection-failed' })
      return
    }
    case 'failed-before-commit': {
      const messageKey = workspacePaneTabCloseErrorKey(feedback.message)
      toast.error(translate(messageKey), { id: 'workspace-pane-tab-close-failed' })
      return
    }
    case 'outcome-uncertain': {
      const messageKey = 'error.workspace-tabs-outcome-uncertain'
      toast.warning(translate(messageKey), { id: 'workspace-pane-tabs-outcome-uncertain' })
      return
    }
    case 'request-failed': {
      const messageKey = 'error.workspace-operation-failed'
      toast.error(translate(messageKey), { id: 'workspace-pane-tab-close-failed' })
    }
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
    clearWorkspacePaneTabOpener(workspacePaneTabsTargetForClose(target), target.workspaceRuntimeId, closingIdentity)
    return Promise.resolve(false)
  }
  const transition = prepareWorkspacePaneClosePresentation(
    target,
    closingIdentity,
    options.workspacePaneRoute,
    closingIdentity,
    navigationGeneration,
    options.tabsBeforeRetirement,
  )
  clearWorkspacePaneTabOpener(workspacePaneTabsTargetForClose(target), target.workspaceRuntimeId, closingIdentity)
  const presentationLease = transition.presentationLease
  if (!presentationLease) return Promise.resolve(false)
  const queueTarget = workspacePaneActionTargetFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  })
  return runWorkspacePaneAction(queueTarget, async () => {
    try {
      if (!workspacePaneTabControllerTargetIsCurrent(target)) return false
      const result = await reconcileRetiredWorkspacePaneClosePresentation(presentationLease, options.navigation)
      if (result.kind === 'failed') surfaceWorkspacePaneTabCloseFeedback({ kind: 'presentation-failed' })
      return true
    } finally {
      abandonWorkspacePaneClosePresentation(transition)
    }
  })
}

async function reconcileCommittedWorkspacePaneClosePresentation(input: {
  target: WorkspacePaneTabModel
  transition: WorkspacePaneCloseTransition
  navigation: AppNavigationActions
}): Promise<WorkspacePaneClosePresentationResult> {
  if (!input.transition.wasActive) return { kind: 'settled' }
  if (!workspacePaneTabControllerTargetIsCurrent(input.target)) return { kind: 'settled' }
  try {
    if (!input.transition.presentationLease) {
      const nextEntry = input.transition.nextEntry
      if (!nextEntry) return { kind: 'settled' }
      return (await selectWorkspacePaneControllerTabEntry(input.target, nextEntry, input.navigation))
        ? { kind: 'settled' }
        : { kind: 'superseded' }
    }
    const presented = await commitWorkspacePaneControllerCloseBackTarget(
      input.transition.presentationLease,
      input.navigation,
    )
    return presented ? { kind: 'settled' } : { kind: 'superseded' }
  } catch (err) {
    terminalLog.warn('workspace pane tab closed but its next presentation failed', { err })
    return { kind: 'failed' }
  }
}

async function reconcileRetiredWorkspacePaneClosePresentation(
  presentationLease: WorkspacePaneControllerPresentationLease,
  navigation: AppNavigationActions,
): Promise<WorkspacePaneClosePresentationResult> {
  try {
    return (await commitWorkspacePaneControllerRetirementCloseBackTarget(presentationLease, navigation))
      ? { kind: 'settled' }
      : { kind: 'superseded' }
  } catch (err) {
    terminalLog.warn('workspace pane tab closed but its next presentation failed', { err })
    return { kind: 'failed' }
  }
}

function workspacePaneTabCloseErrorKey(message: string) {
  switch (message) {
    case WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.invalidArguments:
      return WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.invalidArguments
    case WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.runtimeStale:
      return WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.runtimeStale
    case WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.worktreeRemovalInProgress:
      return WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.worktreeRemovalInProgress
    default:
      return WORKSPACE_PANE_TAB_CLOSE_ERROR_KEYS.fallback
  }
}
