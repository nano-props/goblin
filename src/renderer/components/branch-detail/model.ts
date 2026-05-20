import type { RepoState } from '#/renderer/stores/repos.ts'

export type SelectedBranchDetail = ReturnType<typeof getSelectedBranchDetail>

export function getSelectedBranchDetail(repo: RepoState) {
  const branch = repo.branches.find((b) => b.name === repo.selectedBranch) ?? null
  const branchName = branch?.name ?? ''
  const branchLog = branchName ? repo.logsByBranch[branchName] : undefined
  const selectedStatus = branch?.worktreePath ? repo.status.filter((wt) => wt.path === branch.worktreePath) : []
  const statusCount = selectedStatus.reduce((n, wt) => n + wt.entries.length, 0)

  return { branch, branchLog, selectedStatus, statusCount }
}
