import { git, gitResultWithOptions } from '#/system/git/helper.ts'
import { parseStatus, parseWorktrees } from '#/system/git/parsers.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

const WORKTREE_STATUS_CONCURRENCY = 16

interface GetWorktreesOptions {
  includeStatus?: boolean
  signal?: AbortSignal
}

export async function getWorktrees(cwd: string, options?: GetWorktreesOptions): Promise<WorktreeInfo[]> {
  try {
    const output = await git(cwd, ['worktree', 'list', '--porcelain'], { signal: options?.signal })
    const worktrees = parseWorktrees(output)
    if (options?.includeStatus === false) return worktrees

    await mapWithConcurrency(
      worktrees,
      WORKTREE_STATUS_CONCURRENCY,
      async (wt) => {
        if (wt.isBare) return
        try {
          // -z so a filename containing a literal newline doesn't get
          // counted as two changes. Reuse parseStatus so rename / copy
          // pairs (R/C take TWO records under -z) collapse into one
          // entry — matching what `git status` shows the user.
          const out = await git(wt.path, ['status', '--porcelain', '-z'], { signal: options?.signal })
          const entries = parseStatus(out)
          wt.isDirty = entries.length > 0
          wt.changeCount = entries.length
        } catch {
          if (options?.signal?.aborted) throw new Error('cancelled')
          wt.isDirty = undefined
        }
      },
      { signal: options?.signal, abort: 'throw' },
    )

    return worktrees
  } catch {
    if (options?.signal?.aborted) throw new Error('cancelled')
    return []
  }
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
      return ['-b', input.mode.localBranch, '--track', '--', input.worktreePath, input.mode.remoteRef]
  }
  const exhaustive: never = input.mode
  return exhaustive
}
