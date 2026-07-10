import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabsTargetForRepoTargetKey } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  commitWorkspacePaneTabs,
  type WorkspacePaneTabsMutationResult,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

interface WorkspacePaneTabsRestoreDetails {
  unresolvedRepos: string[]
  unresolvedTargets: Array<{ repoRoot: string; targetKey: string }>
  failedCommits: WorkspacePaneTabsMutationResult[]
}

export type RestoreWorkspacePaneTabsFromSessionResult =
  | ({ status: 'restored' } & WorkspacePaneTabsRestoreDetails)
  | ({ status: 'failed' } & WorkspacePaneTabsRestoreDetails)
  | ({ status: 'cancelled' } & WorkspacePaneTabsRestoreDetails)

export async function restoreServerWorkspacePaneTabsFromSession(
  workspacePaneTabsByTargetByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
  options: { signal?: AbortSignal } = {},
): Promise<RestoreWorkspacePaneTabsFromSessionResult> {
  // Boot-only import from persisted session state into the server runtime.
  // After this completes, runtime tab changes flow server -> query cache ->
  // eventual session persistence; the saved session is not a live owner.
  const commits: Promise<WorkspacePaneTabsMutationResult>[] = []
  const repos = useReposStore.getState().repos
  const unresolvedRepos: string[] = []
  const unresolvedTargets: Array<{ repoRoot: string; targetKey: string }> = []
  const details = () => ({ unresolvedRepos, unresolvedTargets, failedCommits: [] })
  for (const [repoRoot, tabsByTarget] of Object.entries(workspacePaneTabsByTargetByRepo)) {
    if (options.signal?.aborted) return { status: 'cancelled', ...details() }
    const repo = repos[repoRoot]
    if (!repo) {
      unresolvedRepos.push(repoRoot)
      continue
    }
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      if (options.signal?.aborted) return { status: 'cancelled', ...details() }
      const branchModel = readRepoBranchQueryProjection(repo)
      const target = branchModel
        ? workspacePaneTabsTargetForRepoTargetKey({ repoRoot: repo.id, branches: branchModel.branches }, targetKey)
        : null
      if (!target) {
        unresolvedTargets.push({ repoRoot, targetKey })
        continue
      }
      commits.push(restoreWorkspacePaneTabs({ ...target, repoRuntimeId: repo.repoRuntimeId, tabs }))
    }
  }
  const results = await Promise.all(commits)
  // The terminal client does not currently expose per-request cancellation for
  // workspace-tab commits, so an abort that lands here can only stop boot from
  // advancing; it cannot unsend a mutation already accepted by the server.
  if (options.signal?.aborted) return { status: 'cancelled', ...details() }
  const failedCommits = results.filter((result) => !result.ok || !result.projectionApplied)
  const restoreDetails = {
    unresolvedRepos,
    unresolvedTargets,
    failedCommits,
  }
  if (failedCommits.length > 0 || unresolvedRepos.length > 0 || unresolvedTargets.length > 0) {
    return { status: 'failed', ...restoreDetails }
  }
  return {
    status: 'restored',
    ...restoreDetails,
  }
}

async function restoreWorkspacePaneTabs(input: {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
  tabs: WorkspacePaneTabEntry[]
}): Promise<WorkspacePaneTabsMutationResult> {
  return await commitWorkspacePaneTabs(input)
}
