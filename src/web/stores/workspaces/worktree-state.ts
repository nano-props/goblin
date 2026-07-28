import type { WorktreeStatus } from '#/shared/git-types.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'

export interface BranchWorktreeChanges {
  dirty: boolean
  changeCount: number
}

export function branchWorktreeChanges(
  status: readonly WorktreeStatus[] | undefined,
  branch: BranchSnapshotInfo,
): BranchWorktreeChanges | undefined {
  if (!status || !branch.worktree) return undefined
  const worktreeStatus = status.find((entry) => entry.path === branch.worktree?.path)
  if (!worktreeStatus) return undefined
  const changeCount = worktreeStatus.entries.length
  return { dirty: changeCount > 0, changeCount }
}

export function branchWorktreeStatus(
  status: readonly WorktreeStatus[] | undefined,
  branch: BranchSnapshotInfo | null,
): WorktreeStatus[] | undefined {
  if (!status || !branch?.worktree) return undefined
  const worktreeStatus = status.find((entry) => entry.path === branch.worktree?.path)
  return worktreeStatus ? [worktreeStatus] : undefined
}
