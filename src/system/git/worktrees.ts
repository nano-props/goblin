import { git, gitCommandResultWithOptions } from '#/system/git/git-exec.ts'
import { parseWorktrees } from '#/system/git/parsers.ts'
import type { WorktreeInfo } from '#/shared/git-types.ts'
import type { CommandOutcome } from '#/system/command-execution.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import { WORKTREE_COMMAND_TIMEOUT_MS } from '#/shared/worktree-operation-timeouts.ts'

export async function readWorktreeMembership(cwd: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
  signal?.throwIfAborted()
  const output = await git(cwd, ['worktree', 'list', '--porcelain', '-z'], { signal })
  signal?.throwIfAborted()
  return parseWorktrees(output, process.platform === 'win32' ? 'win32' : 'posix')
}

/** Plain `git worktree remove` — no `--force`. Git refuses on dirty,
 *  locked, or otherwise non-removable worktrees, which is exactly the
 *  safety net we want; the IPC handler has already pre-checked the
 *  expected cases and surfaced friendlier errors, so anything that
 *  reaches here is a corner case worth showing git's own message for. */
export async function removeWorktree(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<CommandOutcome> {
  return gitCommandResultWithOptions(
    cwd,
    { timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS, signal },
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
): Promise<CommandOutcome> {
  return gitCommandResultWithOptions(
    cwd,
    { timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS, signal },
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
