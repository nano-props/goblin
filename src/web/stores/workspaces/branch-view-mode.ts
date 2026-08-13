import type { BranchViewMode } from '#/shared/api-types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'

export const DEFAULT_BRANCH_VIEW_MODE: BranchViewMode = 'all'

export function branchViewModeForWorkspace(
  branchViewModeByWorkspace: Readonly<Record<string, BranchViewMode>>,
  workspaceId: string,
): BranchViewMode {
  return branchViewModeByWorkspace[workspaceId] ?? DEFAULT_BRANCH_VIEW_MODE
}

interface BranchSelectionInput {
  branches: BranchSnapshotInfo[]
  worktrees: readonly RepoWorktreeSnapshot[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
}

interface VisibleBranchesInput {
  branches: BranchSnapshotInfo[]
  worktrees: readonly RepoWorktreeSnapshot[]
  viewMode: BranchViewMode
}

function branchMatchesViewMode(
  branch: BranchSnapshotInfo,
  worktrees: readonly RepoWorktreeSnapshot[],
  viewMode: BranchViewMode,
): boolean {
  if (viewMode === 'worktrees') return !!repoWorktreeForBranch(worktrees, branch.name)
  return true
}

export function visibleBranches({ branches, worktrees, viewMode }: VisibleBranchesInput): BranchSnapshotInfo[] {
  return branches.filter((branch) => branchMatchesViewMode(branch, worktrees, viewMode))
}

export function selectedBranchForBranchSet({
  branches,
  worktrees,
  currentBranch,
  selectedBranch,
  viewMode,
}: BranchSelectionInput): string | null {
  const visible = branches.filter((branch) => branchMatchesViewMode(branch, worktrees, viewMode))
  if (selectedBranch === null) return null
  if (selectedBranch && visible.some((branch) => branch.name === selectedBranch)) return selectedBranch
  return visible.find((branch) => branch.name === currentBranch)?.name ?? visible[0]?.name ?? null
}
