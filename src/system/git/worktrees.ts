import { git, gitResultWithOptions } from '#/system/git/git-exec.ts'
import { parseWorktrees } from '#/system/git/parsers.ts'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function readWorktreeMembership(cwd: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
  signal?.throwIfAborted()
  const output = await git(cwd, ['worktree', 'list', '--porcelain', '-z'], { signal })
  signal?.throwIfAborted()
  return parseWorktrees(output)
}

/** Worktree create/remove can both touch tens of thousands of files
 *  on large repos (mp-main: 7.8 GB, 91k files, ~22s on a hot SSD).
 *  3 minutes gives ~8× headroom on the largest known repo so a slower
 *  external disk or a busy filesystem still stays inside the budget. */
const WORKTREE_OP_TIMEOUT_MS = 180_000

/** Plain `git worktree remove` — no `--force`. Git refuses on dirty,
 *  locked, or otherwise non-removable worktrees, which is exactly the
 *  safety net we want; the IPC handler has already pre-checked the
 *  expected cases and surfaced friendlier errors, so anything that
 *  reaches here is a corner case worth showing git's own message for. */
export async function removeWorktree(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return gitResultWithOptions(
    cwd,
    { timeoutMs: WORKTREE_OP_TIMEOUT_MS, signal },
    'worktree',
    'remove',
    '--',
    worktreePath,
  )
}

/** Create a linked worktree. Supports three modes:
 *  - `newBranch`          : `git worktree add -b <name> -- <path> <base>`
 *  - `existingBranch`     : `git worktree add -- <path> <branch>`
 *  - `trackRemoteBranch`  : `git worktree add -b <local> --track -- <path> <remoteRef>`
 *
 *  Git refuses on path-already-exists, branch-already-exists,
 *  parent-dir-missing, etc.; we surface those errors directly rather than
 *  pre-checking. Validation lives in `normalizeCreateWorktreeInput` so the
 *  same shape flows through the client and the IPC bridge. */
export async function createWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return gitResultWithOptions(
    cwd,
    { timeoutMs: WORKTREE_OP_TIMEOUT_MS, signal },
    'worktree',
    'add',
    ...createWorktreeArgs(input),
  )
}

function createWorktreeArgs(input: CreateWorktreeInput): string[] {
  switch (input.mode.kind) {
    case 'newBranch':
      return ['-b', input.mode.newBranch, '--', input.worktreePath, input.mode.baseRef]
    case 'existingBranch':
      return ['--', input.worktreePath, input.mode.branch]
    case 'trackRemoteBranch':
      return ['-b', input.mode.localBranch, '--track', '--', input.worktreePath, input.mode.remote.ref]
  }
  const exhaustive: never = input.mode
  return exhaustive
}
