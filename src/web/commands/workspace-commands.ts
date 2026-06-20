import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { TerminalSessionBase } from '#/web/components/terminal/types.ts'

interface ShowWorkspacePaneViewCommandOptions {
  repoId: string | null
  tab: WorkspacePaneView
  navigation: MainWindowNavigationActions
}

interface TerminalPrimaryActionCommandOptions {
  repoId: string | null
  navigation: MainWindowNavigationActions
}

export function runShowWorkspacePaneViewCommand({
  repoId,
  tab,
  navigation,
}: ShowWorkspacePaneViewCommandOptions): boolean {
  if (!repoId) return false
  if (tab === 'status') {
    const target = selectedBranchWorkspaceTarget(repoId)
    if (target) {
      openWorkspacePaneView({
        repoId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        type: 'status',
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
