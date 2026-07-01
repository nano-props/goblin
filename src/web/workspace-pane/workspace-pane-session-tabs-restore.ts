import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { bootstrapLog } from '#/web/logger.ts'

export async function restoreServerWorkspacePaneTabsFromSession(
  workspacePaneTabsByBranchByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Promise<boolean> {
  const commits: Promise<boolean>[] = []
  const repos = useReposStore.getState().repos
  for (const [repoRoot, tabsByBranch] of Object.entries(workspacePaneTabsByBranchByRepo)) {
    const repo = repos[repoRoot]
    if (!repo) continue
    for (const [branchName, tabs] of Object.entries(tabsByBranch)) {
      const worktreePath = repo.data.branches.find((branch) => branch.name === branchName)?.worktree?.path
      if (!worktreePath) continue
      commits.push(restoreWorktreeWorkspacePaneTabs({ repoRoot, branchName, worktreePath, tabs }))
    }
  }
  const results = await Promise.all(commits)
  return results.every(Boolean)
}

async function restoreWorktreeWorkspacePaneTabs(input: {
  repoRoot: string
  branchName: string
  worktreePath: string
  tabs: WorkspacePaneTabEntry[]
}): Promise<boolean> {
  try {
    const serverTabs = await terminalBridge.replaceWorkspaceTabs({
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      tabs: input.tabs,
    })
    useReposStore.getState().replaceWorkspacePaneTabs(input.repoRoot, serverTabs, input.branchName)
    return true
  } catch (err) {
    bootstrapLog.warn('workspace pane tabs restore failed', {
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      err,
    })
    return false
  }
}
