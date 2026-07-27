import PQueue from 'p-queue'
import { parseStatus } from '#/system/git/parsers.ts'
import type { StatusEntry, WorktreeInfo, WorktreeStatus } from '#/shared/git-types.ts'
import { mapWithConcurrency, runWithQueuedAdmission } from '#/system/git/concurrency.ts'
import { git } from '#/system/git/git-exec.ts'
import { readWorktreeMembership } from '#/system/git/worktrees.ts'

const WORKTREE_STATUS_CONCURRENCY = 4
// Keep every local `git status` command behind this queue, including patch
// enumeration, so concurrent API paths cannot multiply process fan-out.
const worktreeStatusQueue = new PQueue({ concurrency: WORKTREE_STATUS_CONCURRENCY })

export type WorktreeStatusRead =
  { kind: 'bare'; worktree: WorktreeInfo } | { kind: 'status'; worktree: WorktreeInfo; entries: StatusEntry[] }

export async function sampleWorktreeStatus(
  worktrees: readonly WorktreeInfo[],
  signal?: AbortSignal,
): Promise<WorktreeStatusRead[]> {
  return await mapWithConcurrency(
    [...worktrees],
    WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => await sampleWorktreeStatusForTarget(worktree, signal),
    { signal, abort: 'throw' },
  )
}

export async function sampleWorktreeStatusForTarget(
  worktree: WorktreeInfo,
  signal?: AbortSignal,
): Promise<WorktreeStatusRead> {
  signal?.throwIfAborted()
  if (worktree.isBare) return { kind: 'bare', worktree }
  return {
    kind: 'status',
    worktree,
    entries: await readStatusEntries(worktree.path, ['status', '--porcelain', '-z'], signal),
  }
}

export async function readWorktreeStatusEntriesIncludingAllUntracked(
  worktreePath: string,
  signal?: AbortSignal,
): Promise<StatusEntry[]> {
  return await readStatusEntries(worktreePath, ['status', '--porcelain', '-z', '-uall'], signal)
}

async function readStatusEntries(worktreePath: string, args: string[], signal?: AbortSignal): Promise<StatusEntry[]> {
  const output = await runWithQueuedAdmission(
    worktreeStatusQueue,
    signal,
    async () => await git(worktreePath, args, { signal }),
  )
  signal?.throwIfAborted()
  return parseStatus(output)
}

/** Status for the Status tab — grouped by worktree so multi-worktree
 *  setups see *all* dirty changes, not just the main worktree's. The
 *  main worktree (the one matching `cwd`) sorts first.
 *
 *  We list worktrees with `git worktree list` and run `git status` in
 *  each in parallel. Bare worktrees are omitted. Any other read failure
 *  rejects the complete status read so callers cannot mistake partial data
 *  for an authoritative clean snapshot. */
export async function getWorkingStatus(cwd: string, options?: { signal?: AbortSignal }): Promise<WorktreeStatus[]> {
  const worktrees = await readWorktreeMembership(cwd, options?.signal)
  const samples = await sampleWorktreeStatus(worktrees, options?.signal)
  const filtered = samples.flatMap((sample): WorktreeStatus[] =>
    sample.kind === 'bare'
      ? []
      : [
          {
            path: sample.worktree.path,
            branch: sample.worktree.branch,
            isMain: sample.worktree.isPrimary,
            entries: sample.entries,
          },
        ],
  )
  // Main worktree first; the rest keep `git worktree list`'s order
  // (creation order — stable and matches what `git worktree list` shows
  // in the terminal).
  filtered.sort((a, b) => Number(b.isMain) - Number(a.isMain))
  return filtered
}
