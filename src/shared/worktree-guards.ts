import path from 'node:path'
import type { WorktreeInfo } from '#/shared/git-types.ts'

export type KnownWorktreeResult = { ok: true; path: string } | { ok: false; message: 'error.invalid-worktree-path' }

function worktreeForPath(worktrees: WorktreeInfo[], worktreePath: string): WorktreeInfo | undefined {
  const resolvedPath = path.resolve(worktreePath)
  return worktrees.find((worktree) => path.resolve(worktree.path) === resolvedPath)
}

export function resolveKnownWorktree(worktrees: WorktreeInfo[], worktreePath: string): KnownWorktreeResult {
  const target = worktreeForPath(worktrees, worktreePath)
  if (!target) {
    return { ok: false, message: 'error.invalid-worktree-path' }
  }
  return { ok: true, path: target.path }
}

export type RemovableWorktreeResult =
  | { ok: true; target: WorktreeInfo }
  | { ok: false; message: 'error.cannot-remove-main-worktree' | 'error.worktree-not-found' }

export function resolveRemovableWorktree(
  worktrees: WorktreeInfo[],
  worktreePath: string,
  mainWorktreePath: string,
): RemovableWorktreeResult {
  const target = worktreeForPath(worktrees, worktreePath)
  if (!target) return { ok: false, message: 'error.worktree-not-found' }
  if (
    !target.path ||
    target.isPrimary ||
    (!!mainWorktreePath && path.resolve(target.path) === path.resolve(mainWorktreePath))
  ) {
    return { ok: false, message: 'error.cannot-remove-main-worktree' }
  }
  return { ok: true, target }
}
