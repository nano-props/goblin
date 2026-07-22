import { git, gitResultWithOptions } from '#/system/git/git-exec.ts'
import { haveSameWorktrees, parseStatus, parseWorktrees } from '#/system/git/parsers.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

const WORKTREE_STATUS_CONCURRENCY = 16

export type WorktreeStatusRead =
  | { kind: 'bare'; worktree: WorktreeInfo }
  | { kind: 'status'; worktree: WorktreeInfo; entries: ReturnType<typeof parseStatus> }

interface GetWorktreesOptions {
  includeStatus?: boolean
  signal?: AbortSignal
}

export async function getWorktrees(cwd: string, options?: GetWorktreesOptions): Promise<WorktreeInfo[]> {
  const worktrees = await readWorktreeMembership(cwd, options?.signal)
  if (options?.includeStatus === false) return worktrees
  const samples = await sampleWorktreeStatus(worktrees, options?.signal)
  const finalWorktrees = await readWorktreeMembership(cwd, options?.signal)
  if (!haveSameWorktrees(worktrees, finalWorktrees)) throw new Error('Worktree membership changed during status read')
  return samples.map((sample) =>
    sample.kind === 'status'
      ? { ...sample.worktree, isDirty: sample.entries.length > 0, changeCount: sample.entries.length }
      : sample.worktree,
  )
}

export async function readWorktreeMembership(cwd: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
  signal?.throwIfAborted()
  const output = await git(cwd, ['worktree', 'list', '--porcelain', '-z'], { signal })
  signal?.throwIfAborted()
  return parseWorktrees(output)
}

export async function sampleWorktreeStatus(
  worktrees: readonly WorktreeInfo[],
  signal?: AbortSignal,
): Promise<WorktreeStatusRead[]> {
  return await mapWithConcurrency(
    [...worktrees],
    WORKTREE_STATUS_CONCURRENCY,
    async (wt): Promise<WorktreeStatusRead> => {
      if (wt.isBare) return { kind: 'bare', worktree: wt }
      const out = await git(wt.path, ['status', '--porcelain', '-z'], { signal })
      const entries = parseStatus(out)
      return { kind: 'status', worktree: wt, entries }
    },
    { signal, abort: 'throw' },
  )
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
