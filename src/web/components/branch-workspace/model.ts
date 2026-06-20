import type { RepoState } from '#/web/stores/repos/types.ts'
import { resourceBusy } from '#/web/stores/repos/resources.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/repos/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
export type SelectedBranchWorkspace = ReturnType<typeof getSelectedBranchWorkspace>
export type SelectedBranchWorkspacePresentation = ReturnType<typeof getSelectedBranchWorkspacePresentation>

export interface BranchWorkspaceRepo extends BranchActionRepo {
  data: BranchActionRepo['data'] & Pick<RepoState['data'], 'branches' | 'statusLoaded'>
  ui: Pick<RepoState['ui'], 'selectedBranch' | 'preferredWorkspacePaneView' | 'openBranchWorkspacePaneViews'>
  resources: Pick<RepoState['resources'], 'status' | 'pullRequests'>
  remote: BranchActionRepo['remote'] & Pick<RepoState['remote'], 'lifecycle'>
}

export function getSelectedBranchWorkspace(repo: BranchWorkspaceRepo) {
  const branch = repo.data.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const selectedStatus = selectedBranchStatus(repo, branch)
  const worktreeState = branch ? getBranchWorktreeState(repo, branch) : null
  const statusCount = worktreeState?.changeCount ?? selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  // The branch workspace presentation reads the target from the lifecycle
  // union via `remoteRepoTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `repoId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useReposStore` (the
  // presentation object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { repoId: repo.id, branch, selectedStatus, statusCount, worktreeState }
}

export function getSelectedBranchWorkspacePresentation(repo: BranchWorkspaceRepo) {
  const detail = getSelectedBranchWorkspace(repo)
  const statusLoading = resourceBusy(repo.resources.status)

  return {
    ...detail,
    loading: {
      status: statusLoading,
      pullRequests: resourceBusy(repo.resources.pullRequests),
    },
    errors: {
      status: repo.resources.status.error,
    },
    stale: {
      status: repo.resources.status.stale,
    },
  }
}
