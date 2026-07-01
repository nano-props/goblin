import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabsTargetForRepoTargetKey } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { commitWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

export async function restoreServerWorkspacePaneTabsFromSession(
  workspacePaneTabsByTargetByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Promise<boolean> {
  const commits: Promise<boolean>[] = []
  const repos = useReposStore.getState().repos
  let allTargetsResolved = true
  for (const [repoRoot, tabsByTarget] of Object.entries(workspacePaneTabsByTargetByRepo)) {
    const repo = repos[repoRoot]
    if (!repo) {
      allTargetsResolved = false
      continue
    }
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = workspacePaneTabsTargetForRepoTargetKey(repo, targetKey)
      if (!target) {
        allTargetsResolved = false
        continue
      }
      commits.push(restoreWorkspacePaneTabs({ ...target, tabs }))
    }
  }
  const results = await Promise.all(commits)
  return allTargetsResolved && results.every(Boolean)
}

async function restoreWorkspacePaneTabs(input: {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}): Promise<boolean> {
  return await commitWorkspacePaneTabs(input)
}
