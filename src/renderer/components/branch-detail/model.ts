import type { RepoState } from '#/renderer/stores/repos/types.ts'

export type SelectedBranchDetail = ReturnType<typeof getSelectedBranchDetail>

export function getSelectedBranchDetail(repo: RepoState) {
  const branch = repo.data.branches.find((b) => b.name === repo.ui.selectedBranch) ?? null
  const branchName = branch?.name ?? ''
  const branchLog = branchName ? repo.data.logsByBranch[branchName] : undefined
  const selectedStatus = branch?.worktreePath ? repo.data.status.filter((wt) => wt.path === branch.worktreePath) : []
  const statusCount = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return { branch, branchLog, selectedStatus, statusCount }
}
