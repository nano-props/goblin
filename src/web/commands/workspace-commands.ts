import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'
import { isBranchLevelWorkspacePaneView } from '#/web/lib/workspace-pane-view.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { selectedWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'

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

interface CloseTerminalTabOrWindowCommandOptions {
  repoId: string | null
  closeWindow?: () => void
}

interface SelectWorkspacePaneTabByIndexCommandOptions {
  repoId: string | null
  tabIndex: number
  navigation: MainWindowNavigationActions
}

interface WorkspacePaneCommandTab {
  type: WorkspacePaneView
  key?: string
}

export function runShowWorkspacePaneViewCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneViewCommandOptions): boolean {
  if (!repoId) return false
  if (isBranchLevelWorkspacePaneView(tab)) {
    const target = selectedBranchWorkspaceTarget(repoId)
    if (target) {
      openWorkspacePaneView({
        repoId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        type: tab,
        navigation,
      })
      return true
    }
  }
  if (tab === 'changes') {
    const base = selectedTerminalBase(repoId)
    if (base) {
      openWorkspacePaneView({
        repoId,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        type: tab,
        navigation,
      })
      return true
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
  runShowWorkspacePaneViewCommand({ repoId, tab: 'terminal', navigation })
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
  runShowWorkspacePaneViewCommand({ repoId, tab: 'terminal', navigation })
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  await bridge.createTerminal(base)
  return true
}

export function runCloseTerminalTabOrWindowCommand({
  repoId,
  closeWindow = () => window.close(),
}: CloseTerminalTabOrWindowCommandOptions): boolean {
  if (repoId && closeSelectedTerminalTab(repoId)) return true
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
  runShowWorkspacePaneViewCommand({ repoId, tab: tab.type, navigation })
  if (tab.type === 'terminal' && tab.key && target.worktreeTerminalKey) {
    readTerminalSessionCommandBridge()?.selectTerminal(target.worktreeTerminalKey, tab.key)
  }
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

function closeSelectedTerminalTab(repoId: string): boolean {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo?.ui.selectedBranch) return false
  if (selectedWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) !== 'terminal') return false
  const base = selectedTerminalBase(repoId)
  if (!base) return false
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge?.closeTerminalByDescriptor) return false
  const worktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  const selectedKey = bridge.worktreeSnapshot(worktreeKey).selectedDescriptor?.key
  if (!selectedKey) return false
  bridge.closeTerminalByDescriptor(selectedKey, base)
  return true
}

function workspacePaneCommandTarget(repoId: string): {
  worktreeTerminalKey: string | null
  tabs: WorkspacePaneCommandTab[]
} | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branchName = repo.ui.selectedBranch
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const branchTabs: WorkspacePaneCommandTab[] = branchWorkspacePaneViewsForBranch(repo.ui, branchName).map((type) => ({
    type,
  }))
  const worktreePath = branch.worktree?.path
  if (!worktreePath) return { worktreeTerminalKey: null, tabs: branchTabs }

  const worktreeKey = worktreeTerminalKey(repo.id, worktreePath)
  const runtimeTabs = readTerminalSessionCommandBridge()?.worktreeSnapshot(worktreeKey).workspacePaneViews ?? []
  const runtimeBranchTabs = runtimeTabs.filter((tab) => isBranchLevelWorkspacePaneView(tab.type))
  const hasSameBranchTabs =
    runtimeBranchTabs.length === branchTabs.length &&
    runtimeBranchTabs.every((tab) => branchTabs.some((branchTab) => branchTab.type === tab.type))
  const tabs = hasSameBranchTabs
    ? runtimeTabs
    : [...branchTabs, ...runtimeTabs.filter((tab) => !isBranchLevelWorkspacePaneView(tab.type))]
  return {
    worktreeTerminalKey: worktreeKey,
    tabs: tabs.map((tab) =>
      tab.type === 'terminal' && 'key' in tab ? { type: 'terminal', key: tab.key } : { type: tab.type },
    ),
  }
}
