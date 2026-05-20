import path from 'node:path'
import type { WorktreeInfo } from '#/shared/git-types.ts'

type KnownWorktreeResult =
  | { ok: true; path: string }
  | { ok: false; message: 'error.invalid-worktree-path' | 'error.worktree-not-found-for-branch' }

export function resolveKnownWorktree(
  worktrees: WorktreeInfo[],
  worktreePath: string,
  branch?: string,
): KnownWorktreeResult {
  const target = worktrees.find(
    (wt) => path.resolve(wt.path) === path.resolve(worktreePath) && (!branch || wt.branch === branch),
  )
  if (!target)
    return { ok: false, message: branch ? 'error.worktree-not-found-for-branch' : 'error.invalid-worktree-path' }
  return { ok: true, path: target.path }
}

type RemovableWorktreeResult =
  | { ok: true; target: WorktreeInfo }
  | { ok: false; message: 'error.cannot-remove-main-worktree' | 'error.worktree-not-found-for-branch' }

/** Locate the worktree the renderer asked to remove and reject removing
 *  the main / repo-root worktree. Match on path AND branch so a stale
 *  renderer (branch checked out elsewhere since the snapshot) can't
 *  accidentally remove the wrong worktree. */
export function resolveRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  repoRoot: string,
): RemovableWorktreeResult {
  const target = worktrees.find((wt) => path.resolve(wt.path) === path.resolve(worktreePath) && wt.branch === branch)
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (!repoRoot || !target.path || target.isPrimary || path.resolve(target.path) === path.resolve(repoRoot)) {
    return { ok: false, message: 'error.cannot-remove-main-worktree' }
  }
  return { ok: true, target }
}
