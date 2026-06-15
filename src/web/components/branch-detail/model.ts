import type { RepoState } from '#/web/stores/repos/types.ts'
import { resourceBusy } from '#/web/stores/repos/resources.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/repos/worktree-state.ts'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
export type SelectedBranchDetail = ReturnType<typeof getSelectedBranchDetail>
export type SelectedBranchDetailPresentation = ReturnType<typeof getSelectedBranchDetailPresentation>

export interface BranchDetailRepo extends BranchActionRepo {
  data: BranchActionRepo['data'] & Pick<RepoState['data'], 'branches' | 'statusLoaded'>
  ui: Pick<RepoState['ui'], 'selectedBranch' | 'preferredDetailTab'>
  resources: Pick<RepoState['resources'], 'status' | 'pullRequests'>
  remote: BranchActionRepo['remote'] & Pick<RepoState['remote'], 'lifecycle'>
}

export function getSelectedBranchDetail(repo: BranchDetailRepo) {
  const branch = repo.data.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const selectedStatus = selectedBranchStatus(repo, branch)
  const worktreeState = branch ? getBranchWorktreeState(repo, branch) : null
  const statusCount = worktreeState?.changeCount ?? selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  // The detail presentation reads the target from the lifecycle
  // union via `remoteRepoTarget`; we don't mirror it on the
  // `remote` shape anymore (Phase 4 removed the legacy
  // `target` field). `repoId` is forwarded so consumers can
  // re-resolve the live lifecycle via `useReposStore` (the
  // detail object is a snapshot — it doesn't re-render on
  // lifecycle transitions).
  return { repoId: repo.id, branch, selectedStatus, statusCount, worktreeState }
}

export function getSelectedBranchDetailPresentation(repo: BranchDetailRepo) {
  const detail = getSelectedBranchDetail(repo)
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
