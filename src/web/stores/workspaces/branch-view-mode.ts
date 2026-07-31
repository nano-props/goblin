import type { BranchViewMode } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'

export const DEFAULT_BRANCH_VIEW_MODE: BranchViewMode = 'all'

export function branchViewModeForWorkspace(
  branchViewModeByWorkspace: Readonly<Record<string, BranchViewMode>>,
  workspaceId: string,
): BranchViewMode {
  return branchViewModeByWorkspace[workspaceId] ?? DEFAULT_BRANCH_VIEW_MODE
}

interface BranchSelectionInput {
  branches: BranchSnapshotInfo[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
}

interface VisibleBranchesInput {
  branches: BranchSnapshotInfo[]
  viewMode: BranchViewMode
}

function branchMatchesViewMode(branch: BranchSnapshotInfo, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktree?.path
  return true
}

export function visibleBranches({ branches, viewMode }: VisibleBranchesInput): BranchSnapshotInfo[] {
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
