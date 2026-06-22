import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneWorktreeStaticViewType } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import {
  adjacentBranchWorkspacePaneTab,
  createBranchWorkspacePaneTabModel,
  nextBranchWorkspacePaneTabAfterClose,
  type BranchWorkspacePaneTab,
  type BranchWorkspacePaneTabModel,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { terminalLog } from '#/web/logger.ts'

interface ShowWorkspacePaneViewCommandOptions {
  repoId: string | null
  tab: WorkspacePaneView
  navigation: MainWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  navigation: MainWindowNavigationActions
}

interface NewTerminalTabCommandOptions {
  repoId: string | null
  navigation: MainWindowNavigationActions
}

interface CloseWorkspacePaneTabCommandOptions {
  repoId: string | null
  navigation: MainWindowNavigationActions
  targetIdentity?: string
}

interface CloseWorkspacePaneTabOrWindowCommandOptions extends CloseWorkspacePaneTabCommandOptions {
  closeWindow?: () => void
}

type CloseWorkspacePaneCommandTabResult =
  | { handled: false }
  | {
      handled: true
      committed: Promise<boolean>
    }

interface SelectWorkspacePaneTabByIndexCommandOptions {
  repoId: string | null
  tabIndex: number
  navigation: MainWindowNavigationActions
}

interface MoveWorkspacePaneTabCommandOptions {
  repoId: string | null
  direction: 1 | -1
  navigation: MainWindowNavigationActions
}

export async function runShowWorkspacePaneViewCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneViewCommandOptions): Promise<boolean> {
  if (!repoId) return false
  if (isBranchLevelWorkspacePaneView(tab)) {
    const target = selectedBranchWorkspaceTarget(repoId)
    if (target) {
      return openWorkspacePaneView({
        repoId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        type: tab,
        navigation,
      })
    }
  }
  if (tab === 'changes') {
    const base = selectedTerminalBase(repoId)
    if (base) {
      return openWorkspacePaneView({
        repoId,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        type: tab,
        navigation,
      })
    }
  }
  navigation.showRepoWorkspacePaneView(repoId, tab)
  return true
}

export async function runTerminalPrimaryActionCommand({
  repoId,
  navigation,
}: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  if (!repoId) return false
  await runShowWorkspacePaneViewCommand({ repoId, tab: 'terminal', navigation })
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
  await bridge.createTerminal(base)
  return true
}

export async function runNewTerminalTabCommand({ repoId, navigation }: NewTerminalTabCommandOptions): Promise<boolean> {
  if (!repoId) return false
  const base = selectedTerminalBase(repoId)
  if (!base) return false
  await runShowWorkspacePaneViewCommand({ repoId, tab: 'terminal', navigation })
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  await bridge.createTerminal(base)
  return true
}

export async function runCloseWorkspacePaneTabCommand({
  repoId,
  navigation,
  targetIdentity,
}: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  const target = repoId ? workspacePaneCommandTarget(repoId) : null
  const tab = targetIdentity
    ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target?.activeTab ?? null)
  if (!target || !tab) return false

  const isActive = target.activeTab?.identity === tab.identity
  const nextTab = isActive ? nextBranchWorkspacePaneTabAfterClose(target.tabs, tab.identity) : null
  const closeResult = closeWorkspacePaneCommandTab(target, tab)
  if (!closeResult.handled) return false

  if (isActive && nextTab) showWorkspacePaneCommandTab(target, nextTab, navigation)
  const committed = await closeResult.committed
  if (
    !committed &&
    isActive &&
    nextTab &&
    isSelectedWorkspacePaneCommandTab(target.repoId, target.branchName, nextTab)
  ) {
    showWorkspacePaneCommandTab(target, tab, navigation)
  }
  return true
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
  const tab = target ? adjacentBranchWorkspacePaneTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  showWorkspacePaneCommandTab(target, tab, navigation)
  return true
}

function selectedTerminalBase(repoId: string): TerminalSessionBase | null {
  const target = selectedBranchWorkspaceTarget(repoId)
  if (!target?.worktreePath) return null
  return {
    repoRoot: repoId,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}

function selectedBranchWorkspaceTarget(repoId: string): { branchName: string; worktreePath: string | null } | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branch = repo.data.branches.find((candidate) => candidate.name === repo.ui.selectedBranch)
  if (!branch) return null
  return { branchName: branch.name, worktreePath: branch.worktree?.path ?? null }
}

function closeWorkspacePaneCommandTab(
  target: BranchWorkspacePaneTabModel,
  tab: BranchWorkspacePaneTab,
): CloseWorkspacePaneCommandTabResult {
  if (tab.type === 'terminal') return closeTerminalWorkspacePaneCommandTab(target, tab)
  const branchName = target.branchName
  if (!branchName) return { handled: false }

  const branchViewType = isBranchLevelWorkspacePaneView(tab.type) ? tab.type : null
  if (branchViewType) {
    useReposStore.getState().closeBranchWorkspacePaneView(target.repoId, branchViewType, branchName)
    return committedCloseResult(true)
  }

  if (tab.scope !== 'worktree' || !target.worktreeTerminalKey) return committedCloseResult(true)
  if (!isWorkspacePaneWorktreeStaticViewType(tab.type)) return committedCloseResult(true)
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return committedCloseResult(true)
  const committed = bridge.closeWorkspacePaneView(target.worktreeTerminalKey, tab.type).catch((err) => {
    terminalLog.warn('failed to close workspace pane view', { err, type: tab.type })
    return false
  })
  return { handled: true, committed }
}

function closeTerminalWorkspacePaneCommandTab(
  target: BranchWorkspacePaneTabModel,
  tab: BranchWorkspacePaneTab,
): CloseWorkspacePaneCommandTabResult {
  if (!target.terminalBase || !tab.key) return { handled: false }
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge?.closeTerminalByDescriptor) return { handled: false }
  bridge.closeTerminalByDescriptor(tab.key, target.terminalBase)
  return committedCloseResult(true)
}

function committedCloseResult(committed: boolean): CloseWorkspacePaneCommandTabResult {
  return { handled: true, committed: Promise.resolve(committed) }
}

function showWorkspacePaneCommandTab(
  target: BranchWorkspacePaneTabModel,
  tab: BranchWorkspacePaneTab,
  navigation: MainWindowNavigationActions,
): void {
  navigation.showRepoWorkspacePaneView(target.repoId, tab.type)
  if (tab.type === 'terminal' && tab.key && target.worktreeTerminalKey) {
    readTerminalSessionCommandBridge()?.selectTerminal(target.worktreeTerminalKey, tab.key)
  }
}

function isSelectedWorkspacePaneCommandTab(
  repoId: string,
  branchName: string | null,
  tab: BranchWorkspacePaneTab,
): boolean {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo || repo.ui.selectedBranch !== branchName) return false
  return preferredWorkspacePaneViewForBranch(repo.ui, branchName) === tab.type
}

function workspacePaneCommandTarget(repoId: string): BranchWorkspacePaneTabModel | null {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branchName = repo.ui.selectedBranch
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const worktreePath = branch.worktree?.path
  const terminalSyncReady = useRepoSyncStore.getState().ready.get(repoId) === repo.instanceToken
  const worktreeKey = worktreePath ? worktreeTerminalKey(repo.id, worktreePath) : null
  const snapshot = worktreeKey ? (readTerminalSessionCommandBridge()?.worktreeSnapshot(worktreeKey) ?? null) : null
  return createBranchWorkspacePaneTabModel({
    repoId,
    branchName,
    worktreePath: worktreePath ?? null,
    preferredView: preferredWorkspacePaneViewForBranch(repo.ui, branchName),
    openBranchViews: branchWorkspacePaneViewsForBranch(repo.ui, branchName),
    runtimeWorktreeViews: snapshot?.workspacePaneViews ?? [],
    terminalSessionCount: snapshot?.count ?? 0,
    terminalSyncReady,
  })
}
