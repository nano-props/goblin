import type { BranchViewMode, RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
interface BranchSelectionInput {
  branches: RepoBranchState[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
}

interface VisibleBranchesInput {
  branches: RepoBranchState[]
  viewMode: BranchViewMode
}

function branchMatchesViewMode(branch: RepoBranchState, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktree?.path
  return true
}

export function visibleBranches({ branches, viewMode }: VisibleBranchesInput): RepoBranchState[] {
  return branches.filter((branch) => branchMatchesViewMode(branch, viewMode))
}

export function selectedBranchForBranchSet({
  branches,
  currentBranch,
  selectedBranch,
  viewMode,
}: BranchSelectionInput): string | null {
  const visible = branches.filter((branch) => branchMatchesViewMode(branch, viewMode))
  if (selectedBranch === null) return null
  if (selectedBranch && visible.some((branch) => branch.name === selectedBranch)) return selectedBranch
  return visible.find((branch) => branch.name === currentBranch)?.name ?? visible[0]?.name ?? null
}

export function selectedBranchForViewMode(repo: RepoState, viewMode: BranchViewMode): string | null {
  return selectedBranchForBranchSet({
    branches: repo.data.branches,
    currentBranch: repo.data.currentBranch,
    selectedBranch: repo.ui.selectedBranch,
    viewMode,
  })
}

function branchForVisibleLog(repo: RepoState): string | null {
  return repo.ui.selectedBranch ?? (repo.ui.branchViewMode === 'all' ? repo.data.currentBranch : null)
}
