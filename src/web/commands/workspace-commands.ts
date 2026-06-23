import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import { readTerminalSlotCommandBridge } from '#/web/components/terminal/terminal-slot-command-bridge.ts'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import { isWorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import type { TerminalSlotBase } from '#/web/components/terminal/types.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import {
  adjacentBranchWorkspacePaneTab,
  createBranchWorkspacePaneTabModel,
  type BranchWorkspacePaneTab,
  type BranchWorkspacePaneTabModel,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { createWorkspacePaneTerminalTab } from '#/web/stores/repos/workspace-pane-terminal-write-paths.ts'

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
  if (isWorkspacePaneStaticViewType(tab)) {
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
  const bridge = readTerminalSlotCommandBridge()
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
  await createWorkspacePaneTerminalTab({ base, createTerminal: bridge.createTerminal })
  return true
}

export async function runNewTerminalTabCommand({ repoId, navigation }: NewTerminalTabCommandOptions): Promise<boolean> {
  if (!repoId) return false
  const base = selectedTerminalBase(repoId)
  if (!base) return false
  await runShowWorkspacePaneViewCommand({ repoId, tab: 'terminal', navigation })
  const bridge = readTerminalSlotCommandBridge()
  if (!bridge) return true
  await createWorkspacePaneTerminalTab({ base, createTerminal: bridge.createTerminal })
  return true
}

export async function runCloseWorkspacePaneTabCommand({
  repoId,
  navigation: _navigation,
  targetIdentity,
}: CloseWorkspacePaneTabCommandOptions): Promise<boolean> {
  const target = repoId ? workspacePaneCommandTarget(repoId) : null
  if (!target) return false
  if (!targetIdentity && target.selection?.kind === 'terminal-host') return true
  const tab = targetIdentity
    ? (target?.tabs.find((candidate) => candidate.identity === targetIdentity) ?? null)
    : (target?.activeTab ?? null)
  if (!tab) return false

  // Capture pre-close state for the workspace pane tab model. The model uses
  // `lastClosedTabContext` to prefer the spatial neighbor of the closed tab
  // over its generic tabs[0] fallback when the preferred view becomes
  // unrenderable — preserving spatial locality without this command
  // imperatively re-selecting anything.
  const previousTabIdentities = target.tabs.map((t) => t.identity)
  const closingIdentity = tab.identity

  const handled = await closeWorkspacePaneCommandTab(target, tab)
  if (!handled) return false

  if (target.branchName) {
    useReposStore.getState().setLastClosedTabContext(target.repoId, target.branchName, {
      closingIdentity,
      previousTabIdentities,
    })
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
  const tab = target ? adjacentBranchWorkspacePaneTab(target.tabs, target.activeTab?.identity, direction) : null
  if (!target || !tab) return false
  showWorkspacePaneCommandTab(target, tab, navigation)
  return true
}

function selectedTerminalBase(repoId: string): TerminalSlotBase | null {
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
): Promise<boolean> {
  if (tab.kind === 'pending') return Promise.resolve(false)
  if (tab.kind === 'terminal') return closeTerminalWorkspacePaneCommandTab(target, tab)
  const branchName = target.branchName
  if (!branchName) return Promise.resolve(false)
  if (isWorkspacePaneStaticViewType(tab.type)) {
    useReposStore.getState().closeWorkspacePaneStaticView(target.repoId, tab.type, branchName)
  }
  return Promise.resolve(true)
}

function closeTerminalWorkspacePaneCommandTab(
  target: BranchWorkspacePaneTabModel,
  tab: Extract<BranchWorkspacePaneTab, { kind: 'terminal' }>,
): Promise<boolean> {
  if (!target.terminalBase) return Promise.resolve(false)
  const bridge = readTerminalSlotCommandBridge()
  if (!bridge?.closeTerminalByDescriptor) return Promise.resolve(false)
  bridge.closeTerminalByDescriptor(tab.key, target.terminalBase)
  return Promise.resolve(true)
}

function showWorkspacePaneCommandTab(
  target: BranchWorkspacePaneTabModel,
  tab: BranchWorkspacePaneTab,
  navigation: MainWindowNavigationActions,
): void {
  navigation.showRepoWorkspacePaneView(target.repoId, tab.type)
  if (tab.kind === 'terminal' && target.worktreeTerminalKey) {
    readTerminalSlotCommandBridge()?.selectTerminal(target.worktreeTerminalKey, tab.key)
  }
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
  const snapshot = worktreeKey ? (readTerminalSlotCommandBridge()?.worktreeSnapshot(worktreeKey) ?? null) : null
  return createBranchWorkspacePaneTabModel({
    repoId,
    branchName,
    worktreePath: worktreePath ?? null,
    preferredView: preferredWorkspacePaneViewForBranch(repo.ui, branchName),
    tabOrder: workspacePaneTabOrderForBranch(repo.ui, branchName),
    runtimeTerminalViews: snapshot?.sessions ?? [],
    terminalSessionCount: snapshot?.count ?? 0,
    terminalCreatePending: snapshot?.pendingCreate ?? false,
    terminalSyncReady,
    lastClosedTabContext: repo.ui.lastClosedTabContextByBranch[branchName] ?? null,
  })
}
