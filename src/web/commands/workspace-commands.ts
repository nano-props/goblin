import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import { isShellProcessName } from '#/shared/terminal-process-name.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useTerminalActionDialogsStore } from '#/web/stores/repos/terminal-action-dialogs.ts'
import { gblLog } from '#/web/logger.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
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
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { beginWorkspacePaneTabClose } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { runWorkspacePaneTabUiCommand } from '#/web/workspace-pane/workspace-pane-tab-command-queue.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

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

interface CloseWorkspacePaneTabCommandOptions {
  repoId: string | null
  navigation: PrimaryWindowNavigationActions
  targetIdentity?: string
  skipTerminalCloseConfirm?: boolean
}

interface CloseWorkspacePaneTabOrWindowCommandOptions extends CloseWorkspacePaneTabCommandOptions {
  closeWindow?: () => void
}

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
  return await runWorkspacePaneTabUiCommand(() => showWorkspacePaneTabCommand({ repoId, tab, navigation }))
}

function showWorkspacePaneTabCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneTabCommandOptions): boolean {
  if (!repoId) return false
  const provider = workspacePaneTabProvider(tab)
  if (isWorkspacePaneStaticTabProvider(provider)) {
    const target = selectedRepoWorkspaceTarget(repoId)
    if (target) {
      return openWorkspacePaneTab({
        repoId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        type: provider.type,
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
  await runShowWorkspacePaneTabCommand({ repoId, tab: 'terminal', navigation })
  const base = selectedTerminalBase(repoId)
  if (!base) return true
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  const worktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  const worktree = bridge.worktreeSnapshot(worktreeKey)
  if (worktree.count > 0) {
    // The user expects "click the Terminal menu" to land them on a working
    // terminal session: focus the first existing session instead of leaving
    // the selection on whatever the user had open before.
    const firstSession = worktree.sessions[0]
    if (firstSession) bridge.selectTerminal(worktreeKey, firstSession.key)
    return true
  }
  const result = await runCreateTerminalTabCommand({
    base,
    createTerminal: bridge.createTerminal,
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
  await runShowWorkspacePaneTabCommand({ repoId, tab: 'terminal', navigation })
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  const result = await runCreateTerminalTabCommand({
    base,
    createTerminal: bridge.createTerminal,
    t,
  })
  return result.ok
}

export async function runCloseWorkspacePaneTabCommand({
  repoId,
  navigation,
  targetIdentity,
  skipTerminalCloseConfirm,
}: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  return await runWorkspacePaneTabUiCommand(() =>
    closeWorkspacePaneTabCommand({ repoId, navigation, targetIdentity, skipTerminalCloseConfirm }),
  )
}

function closeWorkspacePaneTabCommand({
  repoId,
  navigation,
  targetIdentity,
  skipTerminalCloseConfirm,
}: CloseWorkspacePaneTabCommandOptions): boolean {
  const target = repoId ? workspacePaneCommandTarget(repoId) : null
  if (!target) return false
  if (!targetIdentity && target.selection?.kind === 'terminal-host') return true
  const tab = targetIdentity
    ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target?.activeTab ?? null)
  if (!tab) return false
  if (!skipTerminalCloseConfirm && tab.kind === 'terminal' && shouldConfirmTerminalClose(tab)) {
    useTerminalActionDialogsStore.getState().openCloseConfirm({
      repoId: target.repoId,
      targetIdentity: tab.identity,
      processName: tab.view.processName?.trim() || 'terminal',
    })
    return true
  }

  const closingIdentity = tab.identity
  const wasActive = target.activeTab?.identity === closingIdentity
  const nextTab = wasActive ? nextRepoWorkspaceTabAfterClose(target.tabs, closingIdentity) : null

  const close = beginWorkspacePaneTabClose(target, tab)
  if (!close.accepted) return false
  observeWorkspacePaneTabClose(close.completion, closingIdentity)

  if (nextTab) showWorkspacePaneCommandTab(target, nextTab, navigation)
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
  if (await runCloseWorkspacePaneTabCommand(options)) return true
  closeWindow()
  return true
}

export function runSelectWorkspacePaneTabByIndexCommand({
  repoId,
  tabIndex,
  navigation,
}: SelectWorkspacePaneTabByIndexCommandOptions): boolean {
  if (!repoId || tabIndex < 1) return false
  const target = workspacePaneCommandTarget(repoId)
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
  const target = workspacePaneCommandTarget(repoId)
  const tab = target ? adjacentRepoWorkspaceTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  showWorkspacePaneCommandTab(target, tab, navigation)
  return true
}

function selectedTerminalBase(repoId: string): TerminalSessionBase | null {
  const target = selectedRepoWorkspaceTarget(repoId)
  if (!target?.worktreePath) return null
  return {
    repoRoot: repoId,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}

function selectedRepoWorkspaceTarget(repoId: string): { branchName: string; worktreePath: string | null } | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branch = repo.data.branches.find((candidate) => candidate.name === repo.ui.selectedBranch)
  if (!branch) return null
  return { branchName: branch.name, worktreePath: branch.worktree?.path ?? null }
}

function showWorkspacePaneCommandTab(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
  navigation: PrimaryWindowNavigationActions,
): void {
  navigation.showRepoWorkspacePaneTab(target.repoId, tab.type)
  if (tab.kind === 'terminal' && target.worktreeTerminalKey) {
    readTerminalSessionCommandBridge()?.selectTerminal(target.worktreeTerminalKey, tab.key)
  }
}

function workspacePaneCommandTarget(repoId: string): RepoWorkspaceTabModel | null {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  return workspacePaneTabTargetForBranch(repoId, repo.ui.selectedBranch)
}

function observeWorkspacePaneTabClose(completion: Promise<boolean>, identity: string): void {
  void completion.then(
    (ok) => {
      if (!ok) gblLog.warn('workspace pane tab close did not complete', { identity })
    },
    (err) => {
      gblLog.warn('workspace pane tab close failed', { identity, err })
    },
  )
}
