import type { RepoState } from '#/web/stores/repos/types.ts'
import { resourceBusy } from '#/web/stores/repos/resources.ts'
import { getBranchWorktreeState, selectedBranchStatus } from '#/web/stores/repos/worktree-state.ts'
export type SelectedBranchDetail = ReturnType<typeof getSelectedBranchDetail>
export type SelectedBranchDetailPresentation = ReturnType<typeof getSelectedBranchDetailPresentation>

export function getSelectedBranchDetail(repo: RepoState) {
  const branch = repo.data.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const selectedStatus = selectedBranchStatus(repo, branch)
  const worktreeState = branch ? getBranchWorktreeState(repo, branch) : null
  const statusCount = worktreeState?.changeCount ?? selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return { branch, selectedStatus, statusCount, worktreeState, remoteTarget: repo.remote.target }
}

export function getSelectedBranchDetailPresentation(repo: RepoState) {
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
