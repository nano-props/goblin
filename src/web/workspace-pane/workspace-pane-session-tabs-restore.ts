import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { commitWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

export async function restoreServerWorkspacePaneTabsFromSession(
  workspacePaneTabsByBranchByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Promise<boolean> {
  const commits: Promise<boolean>[] = []
  const repos = useReposStore.getState().repos
  for (const [repoRoot, tabsByBranch] of Object.entries(workspacePaneTabsByBranchByRepo)) {
    const repo = repos[repoRoot]
    if (!repo) continue
    for (const [branchName, tabs] of Object.entries(tabsByBranch)) {
      const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
      if (!branch) continue
      const worktreePath = branch.worktree?.path ?? null
      commits.push(restoreWorkspacePaneTabs({ repoRoot, branchName, worktreePath, tabs }))
    }
  }
  const results = await Promise.all(commits)
  return results.every(Boolean)
}

async function restoreWorkspacePaneTabs(input: {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}): Promise<boolean> {
  return await commitWorkspacePaneTabs(input)
}
