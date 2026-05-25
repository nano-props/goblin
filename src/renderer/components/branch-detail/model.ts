import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'

export type SelectedBranchDetail = ReturnType<typeof getSelectedBranchDetail>
export type SelectedBranchDetailPresentation = ReturnType<typeof getSelectedBranchDetailPresentation>

export function getSelectedBranchDetail(repo: RepoState) {
  const branch = repo.data.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const branchName = branch?.name ?? ''
  const branchLog = branchName ? repo.data.logsByBranch[branchName] : undefined
  const selectedStatus = branch?.worktreePath ? repo.data.status.filter((wt) => wt.path === branch.worktreePath) : []
  const statusCount = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return { branch, branchLog, selectedStatus, statusCount }
}

export function getSelectedBranchDetailPresentation(repo: RepoState) {
  const detail = getSelectedBranchDetail(repo)
  const branchLogResource = detail.branch ? repo.resources.logsByBranch[detail.branch.name] : null
  const logLoading = branchLogResource ? resourceBusy(branchLogResource) : false
  const logInitialLoading = logLoading && !detail.branchLog?.entries.length
  const logAppendLoading = logLoading && !!detail.branchLog?.entries.length
  const statusLoading = resourceBusy(repo.resources.status)

  return {
    ...detail,
    loading: {
      status: statusLoading,
      pullRequests: resourceBusy(repo.resources.pullRequests),
      commits: repo.ui.commitDetail.phase === 'opening' || logLoading,
      log: logLoading,
      logInitial: logInitialLoading,
      logAppend: logAppendLoading,
    },
    errors: {
      status: repo.resources.status.error,
    },
  }
}
