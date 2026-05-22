import type { BranchInfo } from '#/renderer/types.ts'
import type { BranchViewMode, RepoState } from '#/renderer/stores/repos/types.ts'

interface BranchSelectionInput {
  branches: BranchInfo[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
}

export function branchMatchesViewMode(branch: BranchInfo, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktreePath
  if (viewMode === 'no-worktree') return !branch.worktreePath
  return true
}

export function visibleBranches(repo: RepoState): BranchInfo[] {
  if (repo.branchViewMode === 'all') return repo.branches
  return repo.branches.filter((branch) => branchMatchesViewMode(branch, repo.branchViewMode))
}

export function selectedBranchForBranchSet({
  branches,
  currentBranch,
  selectedBranch,
  viewMode,
}: BranchSelectionInput): string | null {
  const visible = branches.filter((branch) => branchMatchesViewMode(branch, viewMode))
  if (selectedBranch && visible.some((branch) => branch.name === selectedBranch)) return selectedBranch
  return visible.find((branch) => branch.name === currentBranch)?.name ?? visible[0]?.name ?? null
}

export function selectedBranchForViewMode(repo: RepoState, viewMode: BranchViewMode): string | null {
  return selectedBranchForBranchSet({
    branches: repo.branches,
    currentBranch: repo.currentBranch,
    selectedBranch: repo.selectedBranch,
    viewMode,
  })
}

export function branchForVisibleLog(repo: RepoState): string | null {
  return repo.selectedBranch ?? (repo.branchViewMode === 'all' ? repo.currentBranch : null)
}
