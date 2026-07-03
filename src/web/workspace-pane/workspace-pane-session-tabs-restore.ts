import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabsTargetForRepoTargetKey } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { commitWorkspacePaneTabs, type WorkspacePaneTabsMutationResult } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

interface WorkspacePaneTabsRestoreDetails {
  unresolvedRepos: string[]
  unresolvedTargets: Array<{ repoRoot: string; targetKey: string }>
  failedCommits: WorkspacePaneTabsMutationResult[]
}

export type RestoreWorkspacePaneTabsFromSessionResult =
  | ({ status: 'restored' } & WorkspacePaneTabsRestoreDetails)
  | ({ status: 'failed' } & WorkspacePaneTabsRestoreDetails)

export async function restoreServerWorkspacePaneTabsFromSession(
  workspacePaneTabsByTargetByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Promise<RestoreWorkspacePaneTabsFromSessionResult> {
  // Boot-only import from persisted session state into the server runtime.
  // After this completes, runtime tab changes flow server -> query cache ->
  // eventual session persistence; the saved session is not a live owner.
  const commits: Promise<WorkspacePaneTabsMutationResult>[] = []
  const repos = useReposStore.getState().repos
  const unresolvedRepos: string[] = []
  const unresolvedTargets: Array<{ repoRoot: string; targetKey: string }> = []
  for (const [repoRoot, tabsByTarget] of Object.entries(workspacePaneTabsByTargetByRepo)) {
    const repo = repos[repoRoot]
    if (!repo) {
      unresolvedRepos.push(repoRoot)
      continue
    }
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = workspacePaneTabsTargetForRepoTargetKey(repo, targetKey)
      if (!target) {
        unresolvedTargets.push({ repoRoot, targetKey })
        continue
      }
      commits.push(restoreWorkspacePaneTabs({ ...target, repoInstanceId: repo.instanceId, tabs }))
    }
  }
  const results = await Promise.all(commits)
  const failedCommits = results.filter((result) => !result.ok)
  const details = {
    unresolvedRepos,
    unresolvedTargets,
    failedCommits,
  }
  if (failedCommits.length > 0 || unresolvedRepos.length > 0 || unresolvedTargets.length > 0) {
    return { status: 'failed', ...details }
  }
  return {
    status: 'restored',
    ...details,
  }
}

async function restoreWorkspacePaneTabs(input: {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}): Promise<WorkspacePaneTabsMutationResult> {
  return await commitWorkspacePaneTabs(input)
}
