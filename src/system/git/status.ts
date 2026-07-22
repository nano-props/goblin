import { haveSameWorktrees } from '#/system/git/parsers.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'
import { readWorktreeMembership, sampleWorktreeStatus } from '#/system/git/worktrees.ts'

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
  const finalWorktrees = await readWorktreeMembership(cwd, options?.signal)
  if (!haveSameWorktrees(worktrees, finalWorktrees)) throw new Error('Worktree membership changed during status read')
  const filtered = samples.flatMap((sample): WorktreeStatus[] =>
    sample.kind === 'bare'
      ? []
      : [{
          path: sample.worktree.path,
          branch: sample.worktree.branch,
          isMain: sample.worktree.isPrimary,
          entries: sample.entries,
        }],
  )
  // Main worktree first; the rest keep `git worktree list`'s order
  // (creation order — stable and matches what `git worktree list` shows
  // in the terminal).
  filtered.sort((a, b) => Number(b.isMain) - Number(a.isMain))
  return filtered
}
