import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  adjacentRepoWorkspaceTab,
  isRepoWorkspaceRuntimeTab,
  nextRepoWorkspaceTabAfterClose,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { isWorkspacePaneStaticTabProvider, workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { selectWorkspacePaneRuntimeTab } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'
import { readWorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-action-context.ts'
import {
  confirmWorkspacePaneRuntimeTabClose,
  workspacePaneRuntimeTabCloseConfirmRequest,
  type WorkspacePaneRuntimeTabCloseConfirmRequest,
  workspacePaneRuntimeTabConfirmedCloseBranchName,
  workspacePaneRuntimeTabConfirmedCloseIdentity,
  terminalBaseForRuntimeTabCloseTarget,
  type ConfirmedWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  canConfirmWorkspacePaneRuntimeTabCloseWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import {
  runWorkspacePaneRuntimeNewAction,
  runWorkspacePaneRuntimePrimaryAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { workspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-context.ts'
import { beginWorkspacePaneTabClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  resolveWorkspacePaneTabTargetForBranch,
  workspacePaneTabTargetBlocksInteraction,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { clearWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

type WorkspacePaneCommandRoute = RepoBranchWorkspacePaneRoute | null | undefined

interface ShowWorkspacePaneTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  tab: WorkspacePaneTabType
  navigation: PrimaryWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  skipTerminalCloseConfirm?: boolean
  skipRuntimeCloseConfirm?: boolean
}

interface ConfirmedTerminalClose {
  terminalSessionId: string
  base: TerminalSessionBase
}

interface ConfirmCloseTerminalWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  currentRepoId: string | null
  currentBranchName: string | null
  currentWorkspacePaneRoute: RepoBranchWorkspacePaneRoute | null
  confirmedTerminal: ConfirmedTerminalClose
}

type CloseWorkspacePaneTabOrWindowCommandOptions = CloseWorkspacePaneTabCommandOptions & {
  closeWindow?: () => void
}

type CloseWorkspaceSurfaceIntent = { kind: 'close-tab' } | { kind: 'close-window' } | { kind: 'noop' }

interface SelectWorkspacePaneTabByIndexCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  repoId: string | null
  branchName: string | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export async function runShowWorkspacePaneTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await showWorkspacePaneTabCommand({ repoId, branchName, workspacePaneRoute, tab, navigation })
}

async function showWorkspacePaneTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const target = selectedRepoWorkspaceTarget(repoId, branchName, workspacePaneRoute)
    if (!target) return false
    return await openWorkspacePaneTab({
      repoId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
      type: provider.type,
      workspacePaneRoute,
      insertAfterIdentity: null,
      navigation,
    })
  }
  if (tab === 'terminal')
    return await runTerminalPrimaryActionCommand({ repoId, branchName, workspacePaneRoute, navigation })
  return false
}

export async function runTerminalPrimaryActionCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  return await runWorkspacePaneRuntimePrimaryAction(
    'terminal',
    workspacePaneRuntimeTabCommandContext({
      repoId,
      branchName,
      workspacePaneRoute,
      showRuntimeTab: (type, sessionId) => {
        if (type === 'terminal') return navigation.showRepoBranchTerminalSession(repoId, branchName, sessionId)
        return false
      },
      terminalCreateTranslator: t,
    }),
  )
}

export async function runNewTerminalTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  navigation,
  t,
}: NewTerminalTabCommandOptions): Promise<boolean> {
  if (!repoId || !branchName) return false
  return await runWorkspacePaneRuntimeNewAction(
    'terminal',
    workspacePaneRuntimeTabCommandContext({
      repoId,
      branchName,
      workspacePaneRoute,
      showRuntimeTab: (type, sessionId) => {
        if (type === 'terminal') return navigation.showRepoBranchTerminalSession(repoId, branchName, sessionId)
        return false
      },
      terminalCreateTranslator: t,
    }),
  )
}

export async function runCloseWorkspacePaneTabCommand(options: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await closeWorkspacePaneTabCommand(options)
}

export async function runConfirmCloseTerminalWorkspacePaneTabCommand(
  options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions,
): Promise<boolean> {
  return closeConfirmedTerminalWorkspacePaneTab(options)
}

async function closeWorkspacePaneTabCommand(options: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  const { repoId, navigation, targetIdentity } = options
  const skipRuntimeCloseConfirm = options.skipRuntimeCloseConfirm ?? options.skipTerminalCloseConfirm ?? false
  const target =
    repoId && options.branchName
      ? workspacePaneTabTargetForBranch(repoId, options.branchName, {
          workspacePaneRoute: options.workspacePaneRoute,
        })
      : null
  if (!target) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return true
  const tab = targetIdentity
    ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target?.activeTab ?? null)
  if (!tab) return false
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
    if (openWorkspacePaneRuntimeCloseConfirm(target.repoId, closeConfirm, options.workspacePaneRoute)) return true
  }

  const closingIdentity = tab.identity
  const wasActive = target.activeTab?.identity === closingIdentity
  const openerIdentity =
    wasActive && target.branchName ? workspacePaneTabOpener(target.repoId, target.branchName, closingIdentity) : null
  const nextTab = wasActive ? nextRepoWorkspaceTabAfterClose(target.tabs, closingIdentity, openerIdentity) : null
  const close = beginWorkspacePaneTabClose(target, tab)
  if (!close.accepted) return false
  if (!(await close.completion)) return false
  completeWorkspacePaneTabClose(target.repoId, target.branchName, closingIdentity)
  if (wasActive) return showWorkspacePaneCloseBackTarget(target, nextTab, navigation)
  return true
}

async function closeConfirmedTerminalWorkspacePaneTab(
  options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions,
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
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  if (!canConfirmWorkspacePaneRuntimeTabCloseWithContext(confirmed, closeContext)) return false
  if (!(await confirmWorkspacePaneRuntimeTabClose(confirmed, closeContext))) return false
  completeWorkspacePaneTabClose(
    repoId,
    confirmedBranchName,
    targetIdentity ?? workspacePaneRuntimeTabConfirmedCloseIdentity(confirmed),
  )
  if (wasActive && closeTarget) return showWorkspacePaneCloseBackTarget(closeTarget, nextTab, navigation)
  return true
}

function openWorkspacePaneRuntimeCloseConfirm(
  repoId: string,
  request: WorkspacePaneRuntimeTabCloseConfirmRequest | null,
  workspacePaneRoute: WorkspacePaneCommandRoute,
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

export async function runCloseWorkspacePaneTabOrWindowCommand({
  closeWindow = () => window.close(),
  ...options
}: CloseWorkspacePaneTabOrWindowCommandOptions): Promise<boolean> {
  const intent = resolveCloseWorkspaceSurfaceIntent(options)
  if (intent.kind === 'noop') return true
  if (intent.kind === 'close-window') {
    closeWindow()
    return true
  }
  if (await runCloseWorkspacePaneTabCommand(options)) return true
  return true
}

export function runSelectWorkspacePaneTabByIndexCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  tabIndex,
  navigation,
}: SelectWorkspacePaneTabByIndexCommandOptions): boolean {
  if (!repoId || !branchName || tabIndex < 1) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  if (tab.kind === 'pending') return false
  return showWorkspacePaneCommandTab(target, tab, navigation)
}

export function runMoveWorkspacePaneTabCommand({
  repoId,
  branchName,
  workspacePaneRoute,
  direction,
  navigation,
}: MoveWorkspacePaneTabCommandOptions): boolean {
  if (!repoId || !branchName) return false
  const target = workspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  const tab = target ? adjacentRepoWorkspaceTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  if (workspacePaneTabTargetBlocksInteraction(target)) return false
  return showWorkspacePaneCommandTab(target, tab, navigation)
}

function selectedRepoWorkspaceTarget(
  repoId: string,
  branchName: string,
  workspacePaneRoute: WorkspacePaneCommandRoute,
): { branchName: string; worktreePath: string | null } | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName, { workspacePaneRoute })
  if (resolution.kind !== 'ready') return null
  if (!resolution.target.branchName) return null
  return { branchName: resolution.target.branchName, worktreePath: resolution.target.worktreePath }
}

function showWorkspacePaneCommandTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  navigation: PrimaryWindowNavigationActions,
): boolean {
  const branchName = target.branchName
  if (!branchName) return false
  if (isRepoWorkspaceRuntimeTab(tab)) {
    if (tab.runtimeType === 'terminal') {
      return navigation.showRepoBranchTerminalSession(target.repoId, branchName, tab.sessionId)
    }
    return false
  }
  if (tab.kind === 'static') return navigation.showRepoBranchWorkspacePaneTab(target.repoId, branchName, tab.type)
  return false
}

function showWorkspacePaneCloseBackTarget(
  target: RepoWorkspaceTabModel,
  nextTab: RepoWorkspaceTab | null,
  navigation: PrimaryWindowNavigationActions,
): boolean {
  if (nextTab) return showWorkspacePaneCommandTab(target, nextTab, navigation)
  const branchName = target.branchName
  if (!branchName) return false
  return navigation.showRepoBranchEmptyWorkspacePane(target.repoId, branchName)
}

function completeWorkspacePaneTabClose(repoId: string | null, branchName: string | null, identity: string): void {
  if (repoId && branchName) clearWorkspacePaneTabOpener(repoId, branchName, identity)
}

function resolveCloseWorkspaceSurfaceIntent(options: CloseWorkspacePaneTabCommandOptions): CloseWorkspaceSurfaceIntent {
  const { repoId, targetIdentity } = options
  if (!repoId) return { kind: 'close-window' }
  if (!options.branchName) return { kind: 'close-window' }
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, options.branchName, {
    workspacePaneRoute: options.workspacePaneRoute,
  })
  if (resolution.kind === 'unavailable') return { kind: 'noop' }
  const target = resolution.kind === 'ready' ? resolution.target : null
  if (!target) return { kind: 'close-window' }
  if (targetIdentity) {
    return target.tabs.some((candidate) => candidate.identity === targetIdentity)
      ? { kind: 'close-tab' }
      : { kind: 'noop' }
  }
  if (target.activeTab) return { kind: 'close-tab' }
  if (target.selection?.kind === 'runtime-host') return { kind: 'noop' }
  return { kind: 'close-window' }
}
