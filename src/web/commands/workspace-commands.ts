import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { formatTerminalId } from '#/shared/terminal.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'

interface ShowDetailTabCommandOptions {
  repoId: string | null
  tab: DetailTab
  navigation: MainWindowNavigationActions
  setDetailCollapsed: (collapsed: boolean) => void
}

interface ToggleDetailCommandOptions {
  repoId: string | null
  toggleDetailCollapsed: () => void
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  navigation: MainWindowNavigationActions
  setDetailCollapsed: (collapsed: boolean) => void
}

interface SelectTerminalCommandOptions {
  repoId: string | null
  index: number
  navigation: MainWindowNavigationActions
  setDetailCollapsed: (collapsed: boolean) => void
}

export function runShowDetailTabCommand({
  repoId,
  tab,
  navigation,
  setDetailCollapsed,
}: ShowDetailTabCommandOptions): boolean {
  if (!repoId) return false
  navigation.showRepoDetailTab(repoId, tab)
  setDetailCollapsed(false)
  return true
}

export function runToggleDetailCommand({ repoId, toggleDetailCollapsed }: ToggleDetailCommandOptions): boolean {
  if (!repoId) return false
  toggleDetailCollapsed()
  return true
}

export async function runTerminalPrimaryActionCommand({
  repoId,
  navigation,
  setDetailCollapsed,
}: TerminalPrimaryActionCommandOptions): Promise<boolean> {
  if (!repoId) return false
  runShowDetailTabCommand({ repoId, tab: 'terminal', navigation, setDetailCollapsed })
  const base = selectedTerminalBase(repoId)
  if (!base) return true
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  const worktree = bridge.worktreeSnapshot(worktreeTerminalKey(base.repoRoot, base.worktreePath))
  if (worktree.count > 0) return true
  await bridge.createTerminal(base)
  return true
}

export function runSelectTerminalCommand({
  repoId,
  index,
  navigation,
  setDetailCollapsed,
}: SelectTerminalCommandOptions): boolean {
  if (!repoId || index < 1) return false
  runShowDetailTabCommand({ repoId, tab: 'terminal', navigation, setDetailCollapsed })
  const base = selectedTerminalBase(repoId)
  if (!base) return true
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge) return true
  const worktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  const session = bridge
    .worktreeSnapshot(worktreeKey)
    .sessions.find((candidate) => candidate.index === index || candidate.terminalId === formatTerminalId(index))
  if (!session) return true
  bridge.selectTerminal(worktreeKey, session.key)
  return true
}

function selectedTerminalBase(repoId: string): TerminalSessionBase | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  const branch = repo.data.branches.find((candidate) => candidate.name === repo.ui.selectedBranch)
  const worktreePath = branch?.worktree?.path
  if (!worktreePath) return null
  return {
    repoRoot: repo.id,
    branch: branch.name,
    worktreePath,
  }
}
