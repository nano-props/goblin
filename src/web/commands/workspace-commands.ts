import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import { gblLog } from '#/web/logger.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  adjacentRepoWorkspaceTab,
  nextRepoWorkspaceTabAfterClose,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/tab-model.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import {
  isWorkspacePaneStaticTabProvider,
  terminalWorkspacePaneTabProvider,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { beginWorkspacePaneTabClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import {
  activeWorkspacePaneTabTarget,
  activeWorkspacePaneTabTargetResolution,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  captureWorkspacePaneActiveTabIdentity,
  clearWorkspacePaneTabOpener,
  workspacePaneTabOpener,
} from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

interface ShowWorkspacePaneTabCommandOptions {
  repoId: string | null
  tab: WorkspacePaneTabType
  navigation: PrimaryWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface NewTerminalTabCommandOptions {
  repoId: string | null
  navigation: PrimaryWindowNavigationActions
  t?: TerminalCreateTranslator
}

interface WorkspacePaneTabCommandTargetOptions {
  repoId: string | null
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  skipTerminalCloseConfirm?: boolean
}

interface ConfirmedTerminalClose {
  terminalSessionId: string
  base: TerminalSessionBase
}

interface ConfirmCloseTerminalWorkspacePaneTabCommandOptions extends WorkspacePaneTabCommandTargetOptions {
  confirmedTerminal: ConfirmedTerminalClose
}

type CloseWorkspacePaneTabOrWindowCommandOptions = CloseWorkspacePaneTabCommandOptions & {
  closeWindow?: () => void
}

type CloseWorkspaceSurfaceIntent = { kind: 'close-tab' } | { kind: 'close-window' } | { kind: 'noop' }

interface SelectWorkspacePaneTabByIndexCommandOptions {
  repoId: string | null
  tabIndex: number
  navigation: PrimaryWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  repoId: string | null
  direction: 1 | -1
  navigation: PrimaryWindowNavigationActions
}

export async function runShowWorkspacePaneTabCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await showWorkspacePaneTabCommand({ repoId, tab, navigation })
}

async function showWorkspacePaneTabCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): Promise<boolean> {
  if (!repoId) return false
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const target = selectedRepoWorkspaceTarget(repoId)
    if (target) {
      return await openWorkspacePaneTab({
        repoId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        type: provider.type,
        insertAfterIdentity: null,
        navigation,
      })
    }
  }
  navigation.showRepoWorkspacePaneTab(repoId, tab)
  return true
}

export async function runTerminalPrimaryActionCommand({
  repoId,
  navigation,
  t,
}: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  if (!repoId) return false
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(repoId)
  const enterTerminalTab = enterTerminalWorkspacePaneTab(repoId, navigation)
  const base = selectedTerminalBase(repoId)
  if (!base) {
    await enterTerminalTab()
    return true
  }
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) {
    await enterTerminalTab()
    return true
  }
  const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
  // Synchronous local-state read (no network round trip), so there's no
  // responsiveness cost to deciding *before* switching views — switching is
  // handled per-branch below instead of eagerly up front.
  const worktree = bridge.terminalWorktreeSnapshot(terminalWorktreeKey)
  if (worktree.count > 0) {
    // The user expects "click the Terminal menu" to land them on a working
    // terminal session: focus the first existing session instead of leaving
    // the selection on whatever the user had open before.
    await enterTerminalTab()
    const firstSession = worktree.sessions[0]
    if (firstSession) bridge.selectTerminal(terminalWorktreeKey, firstSession.terminalSessionId)
    return true
  }
  // "Click the Terminal menu" is a generic entry — the new terminal should
  // append to the end of the strip rather than being anchored to whatever
  // tab happens to be active.
  const result = await runCreateTerminalTabCommand({
    base,
    createTerminal: bridge.createTerminal,
    createOwnedTerminal: bridge.createOwnedTerminal,
    openerIdentity,
    enterTerminalTab,
    t,
    logMessage: 'terminal primary action create failed',
  })
  return result.ok
}

export async function runNewTerminalTabCommand({
  repoId,
  navigation,
  t,
}: NewTerminalTabCommandOptions): Promise<boolean> {
  if (!repoId) return false
  const base = selectedTerminalBase(repoId)
  if (!base) return false
  const openerIdentity = captureWorkspacePaneActiveTabIdentity(repoId)
  const enterTerminalTab = enterTerminalWorkspacePaneTab(repoId, navigation)
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) {
    await enterTerminalTab()
    return true
  }
  const result = await runCreateTerminalTabCommand({
    base,
    createTerminal: bridge.createTerminal,
    createOwnedTerminal: bridge.createOwnedTerminal,
    openerIdentity,
    enterTerminalTab,
    t,
  })
  return result.ok
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
  const { repoId, navigation, targetIdentity, skipTerminalCloseConfirm } = options
  const target = repoId ? activeWorkspacePaneTabTarget(repoId) : null
  if (!target) return false
  const tab = targetIdentity
    ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target?.activeTab ?? null)
  if (!tab) return false
  if (!skipTerminalCloseConfirm && tab.kind === 'terminal' && shouldConfirmTerminalClose(tab) && target.terminalBase) {
    useTerminalActionDialogsStore.getState().openCloseConfirm({
      repoId: target.repoId,
      targetIdentity: tab.identity,
      terminalSessionId: tab.terminalSessionId,
      terminalBase: target.terminalBase,
      processName: tab.view.processName?.trim() || 'terminal',
    })
    return true
  }

  const closingIdentity = tab.identity
  const wasActive = target.activeTab?.identity === closingIdentity
  const openerIdentity =
    wasActive && target.branchName ? workspacePaneTabOpener(target.repoId, target.branchName, closingIdentity) : null
  const nextTab = wasActive ? nextRepoWorkspaceTabAfterClose(target.tabs, closingIdentity, openerIdentity) : null
  const initialActiveId = useReposStore.getState().activeId

  const close = beginWorkspacePaneTabClose(target, tab)
  if (!close.accepted) return false
  observeWorkspacePaneTabClose(close.completion, target.repoId, target.branchName, closingIdentity)
  if (tab.kind === 'static' && !(await close.completion)) return false

  if (nextTab && (tab.kind !== 'static' || shouldSelectNextTabAfterStaticClose(target, tab.type, initialActiveId))) {
    showWorkspacePaneCommandTab(target, nextTab, navigation)
  }
  return true
}

function closeConfirmedTerminalWorkspacePaneTab(options: ConfirmCloseTerminalWorkspacePaneTabCommandOptions): boolean {
  const { repoId, navigation, targetIdentity, confirmedTerminal } = options
  const target = repoId ? activeWorkspacePaneTabTarget(repoId) : null
  const tab = targetIdentity ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null) : null
  const wasActive = !!target && !!tab && target.activeTab?.identity === tab.identity
  // Read the opener scoped by the terminal's actual branch (from the
  // confirmed-close payload), not `target.branchName` — the currently
  // selected branch may have changed since the confirm dialog was opened.
  const openerIdentity =
    wasActive && target && tab
      ? workspacePaneTabOpener(target.repoId, confirmedTerminal.base.branch, tab.identity)
      : null
  const nextTab =
    wasActive && target && tab ? nextRepoWorkspaceTabAfterClose(target.tabs, tab.identity, openerIdentity) : null
  const closeTerminalByDescriptor = readTerminalSessionCommandBridge()?.closeTerminalByDescriptor
  if (!closeTerminalByDescriptor) return false
  observeWorkspacePaneTabClose(
    closeTerminalByDescriptor(confirmedTerminal.terminalSessionId, confirmedTerminal.base),
    repoId,
    // The confirmed-close base carries the branch the terminal actually
    // belongs to — more reliable than `target.branchName`, which reflects
    // whatever branch is *currently* selected and may have changed since
    // the confirm dialog was opened.
    confirmedTerminal.base.branch,
    targetIdentity ?? terminalWorkspacePaneTabProvider.identity(confirmedTerminal.terminalSessionId),
  )
  if (target && nextTab) showWorkspacePaneCommandTab(target, nextTab, navigation)
  return true
}

function shouldConfirmTerminalClose(tab: Extract<RepoWorkspaceTab, { kind: 'terminal' }>): boolean {
  if (tab.view.phase !== 'open') return false
  const processName = tab.view.processName?.trim()
  if (!processName) return false
  return !isShellProcessName(processName)
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
  tabIndex,
  navigation,
}: SelectWorkspacePaneTabByIndexCommandOptions): boolean {
  if (!repoId || tabIndex < 1) return false
  const target = activeWorkspacePaneTabTarget(repoId)
  const tab = target?.tabs[tabIndex - 1]
  if (!target || !tab) return false
  if (tab.kind === 'pending') return false
  showWorkspacePaneCommandTab(target, tab, navigation)
  return true
}

export function runMoveWorkspacePaneTabCommand({
  repoId,
  direction,
  navigation,
}: MoveWorkspacePaneTabCommandOptions): boolean {
  if (!repoId) return false
  const target = activeWorkspacePaneTabTarget(repoId)
  const tab = target ? adjacentRepoWorkspaceTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  showWorkspacePaneCommandTab(target, tab, navigation)
  return true
}

function shouldSelectNextTabAfterStaticClose(
  target: RepoWorkspaceTabModel,
  closingTab: WorkspacePaneTabType,
  initialActiveId: string | null,
): boolean {
  if (!target.branchName) return false
  const state = useReposStore.getState()
  const repo = state.repos[target.repoId]
  if (!repo) return false
  if (state.activeId !== initialActiveId || state.activeId !== target.repoId) return false
  if (repo.ui.selectedBranch !== target.branchName) return false
  return (
    preferredWorkspacePaneTabForTarget(repo.ui, {
      repoRoot: target.repoId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
    }) === closingTab
  )
}

function selectedTerminalBase(repoId: string): TerminalSessionBase | null {
  const repo = useReposStore.getState().repos[repoId]
  const target = selectedRepoWorkspaceTarget(repoId)
  if (!repo || !target?.worktreePath) return null
  return {
    repoRoot: repoId,
    repoInstanceId: repo.instanceId,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}

function enterTerminalWorkspacePaneTab(
  repoId: string,
  navigation: PrimaryWindowNavigationActions,
): () => Promise<void> {
  return async () => {
    await runShowWorkspacePaneTabCommand({ repoId, tab: 'terminal', navigation })
  }
}

function selectedRepoWorkspaceTarget(repoId: string): { branchName: string; worktreePath: string | null } | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return null
  const branch = branchModel.branches.find((candidate) => candidate.name === repo.ui.selectedBranch)
  if (!branch) return null
  return { branchName: branch.name, worktreePath: branch.worktree?.path ?? null }
}

function showWorkspacePaneCommandTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  navigation: PrimaryWindowNavigationActions,
): void {
  navigation.showRepoWorkspacePaneTab(target.repoId, tab.type)
  if (tab.kind === 'terminal' && target.terminalWorktreeKey) {
    readTerminalSessionCommandBridge()?.selectTerminal(target.terminalWorktreeKey, tab.terminalSessionId)
  }
}

function observeWorkspacePaneTabClose(
  completion: Promise<boolean>,
  repoId: string | null,
  branchName: string | null,
  identity: string,
): void {
  void completion.then(
    (ok) => {
      if (ok) {
        if (repoId && branchName) clearWorkspacePaneTabOpener(repoId, branchName, identity)
      } else {
        gblLog.warn('workspace pane tab close did not complete', { identity })
      }
    },
    (err) => {
      gblLog.warn('workspace pane tab close failed', { identity, err })
    },
  )
}

function resolveCloseWorkspaceSurfaceIntent(options: CloseWorkspacePaneTabCommandOptions): CloseWorkspaceSurfaceIntent {
  const { repoId, targetIdentity } = options
  if (!repoId) return { kind: 'close-window' }
  const resolution = activeWorkspacePaneTabTargetResolution(repoId)
  if (resolution.kind === 'unavailable') return { kind: 'noop' }
  const target = resolution.kind === 'ready' ? resolution.target : null
  if (!target) return { kind: 'close-window' }
  if (targetIdentity) {
    return target.tabs.some((candidate) => candidate.identity === targetIdentity)
      ? { kind: 'close-tab' }
      : { kind: 'noop' }
  }
  if (target.activeTab) return { kind: 'close-tab' }
  if (target.selection?.kind === 'terminal-host') return { kind: 'noop' }
  return { kind: 'close-window' }
}
