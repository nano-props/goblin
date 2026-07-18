import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { GitHead } from '#/shared/git-head.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  terminalPresentationBranch,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
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
  workspacePaneTabTargetForPaneTarget,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import { workspacePaneTerminalBaseFromCoordinates } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import type { WorkspacePaneRuntimeTabCloseConfirmRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionTargetFromFilesystemTarget,
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
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  paneTarget: WorkspacePaneTabsTarget
  worktreeHead?: GitHead
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
      nextTab: RepoWorkspaceTab | null
      presentationLease: WorkspacePaneControllerPresentationLease | null
      completion: Promise<boolean>
    }

export async function dispatchCloseWorkspacePaneTabAction(
  options: CloseWorkspacePaneTabActionOptions,
): Promise<boolean> {
  if (!options.repoId) return await closeWorkspacePaneTabAction(options)
  const coordinatorTarget = resolveCloseWorkspacePaneTarget(options)
  if (!coordinatorTarget) return false
  const presentationToken = beginPrimaryWindowPresentation()
  return await runWorkspacePaneAction(
    workspacePaneActionTargetFromCoordinates({
      repoId: coordinatorTarget.repoId,
      repoRuntimeId: coordinatorTarget.repoRuntimeId,
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
    if (!(await start.completion)) return false
    completeWorkspacePaneTabClose(start.target, start.closingIdentity)
    if (!start.wasActive) return true
    if (!workspacePaneTabControllerTargetIsCurrent(start.target)) return true
    if (!start.presentationLease) {
      if (start.target.branchName !== null) return false
      return start.nextTab
        ? await selectWorkspacePaneControllerTab(start.target, start.nextTab, options.navigation)
        : true
    }
    const presented = await commitWorkspacePaneControllerCloseBackTarget(start.presentationLease, options.navigation)
    return presented || !primaryWindowPresentationIsCurrent(start.presentationLease.presentationToken)
  })
}

export async function dispatchConfirmCloseTerminalWorkspacePaneTabAction(
  options: ConfirmCloseTerminalWorkspacePaneTabActionOptions,
): Promise<boolean> {
  const base = options.confirmedTerminal.base
  const coordinates = terminalExecutionCoordinates(base.target)
  const queueRepoId = options.repoId ?? coordinates.repoRoot
  const queueRepoRuntimeId = coordinates.repoRuntimeId
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
  const { repoId, navigation, targetIdentity, confirmedTerminal } = options
  const coordinates = terminalExecutionCoordinates(confirmedTerminal.base.target)
  const workspaceConfirmed = confirmedTerminal.base.target.kind === 'workspace-root'
  const gitBranchName = workspaceConfirmed ? null : terminalPresentationBranch(confirmedTerminal.base.presentation)
  const confirmed: ConfirmedWorkspacePaneRuntimeTabClose = {
    type: 'terminal',
    sessionId: confirmedTerminal.terminalSessionId,
    target: confirmedTerminal.base,
  }
  const confirmedIdentity = targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed)
  const closeTarget = repoId ? resolveCloseWorkspacePaneTarget(options) : null
  const currentTarget =
    options.currentRepoId && options.currentRepoId === repoId
      ? workspacePaneTabTargetForPaneTarget(
          options.paneTarget,
          options.currentWorkspacePaneRoute,
          options.worktreeHead,
        )
      : null
  if (closeTarget && workspacePaneTabTargetBlocksInteraction(closeTarget)) return false
  const tab = closeTarget?.tabs.find((candidate) => candidate.identity === confirmedIdentity) ?? null
  const selectedWorkspaceTerminal = workspaceConfirmed
    ? useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[
        formatTerminalWorktreeKey(coordinates.repoRoot, coordinates.worktreeId)
      ]
    : null
  const workspacePreference = workspaceConfirmed
    ? useReposStore.getState().repos[coordinates.repoRoot]?.ui.preferredWorkspacePaneTabByTarget[
        workspacePaneTabsTargetIdentityKey({
          kind: 'workspace-root',
          repoRoot: coordinates.repoRoot,
        })
      ]
    : null
  const workspaceRuntimeCurrent = workspaceConfirmed
    ? useReposStore.getState().repos[coordinates.repoRoot]?.repoRuntimeId === coordinates.repoRuntimeId
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
    wasActive && closeTarget && tab
      ? workspacePaneTabOpener(workspacePaneTabsTargetForModel(closeTarget), closeTarget.repoRuntimeId, tab.identity)
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
      if (state.repos[coordinates.repoRoot]?.repoRuntimeId !== coordinates.repoRuntimeId) {
        return true
      }
      state.setWorkspacePaneTabForTarget(
        {
          kind: 'workspace-root',
          repoRoot: coordinates.repoRoot,
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
  const target = repoId ? resolveCloseWorkspacePaneTarget(options) : null
  if (!target) return { kind: 'done', result: false }
  if (workspacePaneTabTargetBlocksInteraction(target)) return { kind: 'done', result: true }
  const tab = targetIdentity
    ? (target.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target.activeTab ?? null)
  if (!tab) return { kind: 'done', result: false }
  if (!skipRuntimeCloseConfirm && isRepoWorkspaceRuntimeTab(tab)) {
    const terminalBase = terminalBaseForPaneModel(target)
    if (!terminalBase) return { kind: 'done', result: false }
    const closeConfirm = workspacePaneRuntimeTabCloseConfirmRequest({
      type: tab.runtimeType,
      identity: tab.identity,
      sessionId: tab.sessionId,
      view: tab.view,
      target: terminalBase,
    })
    if (openWorkspacePaneRuntimeCloseConfirm(target.repoId, closeConfirm, options.workspacePaneRoute)) {
      return { kind: 'done', result: true }
    }
  }

  const closingIdentity = tab.identity
  const wasActive = target.activeTab?.identity === closingIdentity
  const openerIdentity = wasActive
    ? workspacePaneTabOpener(workspacePaneTabsTargetForModel(target), target.repoRuntimeId, closingIdentity)
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

function terminalBaseForPaneModel(target: RepoWorkspaceTabModel): TerminalSessionBase | null {
  if (!target.worktreePath) return null
  return workspacePaneTerminalBaseFromCoordinates({
    workspaceId: target.repoId,
    workspaceRuntimeId: target.repoRuntimeId,
    branchName: target.branchName,
    rootPath: target.worktreePath,
  })
}

function openWorkspacePaneRuntimeCloseConfirm(
  repoId: string,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
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
  clearWorkspacePaneTabOpener(workspacePaneTabsTargetForModel(target), target.repoRuntimeId, identity)
}

function workspacePaneTabsTargetForModel(target: RepoWorkspaceTabModel): WorkspacePaneTabsTarget {
  if (target.paneTarget.kind === 'inactive') throw new Error('inactive workspace pane has no persistence target')
  return target.paneTarget
}

function resolveCloseWorkspacePaneTarget(
  input: Pick<
    CloseWorkspacePaneTabActionOptions,
    'repoId' | 'workspacePaneRoute' | 'paneTarget' | 'worktreeHead'
  >,
): RepoWorkspaceTabModel | null {
  if (!input.repoId) return null
  return workspacePaneTabTargetForPaneTarget(input.paneTarget, input.workspacePaneRoute, input.worktreeHead)
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
