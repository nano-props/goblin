import type { WorktreeStatus } from '#/shared/git-types.ts'

export interface BranchWorktreeChanges {
  dirty: boolean
  changeCount: number
}

export function worktreeChanges(
  status: readonly WorktreeStatus[] | undefined,
  worktreePath: string | null | undefined,
): BranchWorktreeChanges | undefined {
  if (!status || !worktreePath) return undefined
  const worktreeStatus = status.find((entry) => entry.path === worktreePath)
  if (!worktreeStatus) return undefined
  const changeCount = worktreeStatus.entries.length
  return { dirty: changeCount > 0, changeCount }
}

export function worktreeStatus(
  status: readonly WorktreeStatus[] | undefined,
  worktreePath: string | null | undefined,
): WorktreeStatus[] | undefined {
  if (!status || !worktreePath) return undefined
  const worktreeStatus = status.find((entry) => entry.path === worktreePath)
  return worktreeStatus ? [worktreeStatus] : undefined
}
