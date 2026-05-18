import path from 'node:path'
import type { WorktreeInfo } from '#/shared/git-types.ts'

type KnownWorktreeResult =
  | { ok: true; path: string }
  | { ok: false; message: 'error.invalidWorktreePath' | 'error.worktreeNotFoundForBranch' }

export function resolveKnownWorktree(
  worktrees: WorktreeInfo[],
  worktreePath: string,
  branch?: string,
): KnownWorktreeResult {
  const target = worktrees.find(
    (wt) => path.resolve(wt.path) === path.resolve(worktreePath) && (!branch || wt.branch === branch),
  )
  if (!target) return { ok: false, message: branch ? 'error.worktreeNotFoundForBranch' : 'error.invalidWorktreePath' }
  return { ok: true, path: target.path }
}
