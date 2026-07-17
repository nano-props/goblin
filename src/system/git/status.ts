import { git } from '#/system/git/git-exec.ts'
import { parseStatus, parseUsableWorktrees } from '#/system/git/parsers.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'
import { worktreePathIsMissing } from '#/system/git/worktree-path.ts'

const WORKTREE_STATUS_CONCURRENCY = 16

/** Status for the Status tab — grouped by worktree so multi-worktree
 *  setups see *all* dirty changes, not just the main worktree's. The
 *  main worktree (the one matching `cwd`) sorts first.
 *
 *  We list worktrees with `git worktree list` and run `git status` in
 *  each in parallel. Bare worktrees are omitted. Any other read failure
 *  rejects the complete status read so callers cannot mistake partial data
 *  for an authoritative clean snapshot. */
export async function getWorkingStatus(cwd: string, options?: { signal?: AbortSignal }): Promise<WorktreeStatus[]> {
  options?.signal?.throwIfAborted()
  const out = await git(cwd, ['worktree', 'list', '--porcelain'], { signal: options?.signal })
  options?.signal?.throwIfAborted()
  const worktrees = parseUsableWorktrees(out)

  const results = await mapWithConcurrency(
    worktrees,
    WORKTREE_STATUS_CONCURRENCY,
    async (wt): Promise<WorktreeStatus | null> => {
      if (wt.isBare) return null
      // -z: NUL-terminated entries with quoting disabled. Without this,
      // filenames containing spaces, quotes, or unicode get backslash-
      // escaped and double-quoted (e.g. `"file name.txt"`), which the LF
      // parser leaves as literal quotes in the output. -z gives us the
      // raw bytes and uses NUL between entries.
      let output: string
      try {
        output = await git(wt.path, ['status', '--porcelain', '-z'], { signal: options?.signal })
      } catch (error) {
        options?.signal?.throwIfAborted()
        // The worktree can disappear after the authoritative list read. Only
        // suppress the command failure after independently confirming that
        // its physical directory is gone; Git/process/permission failures for
        // an existing member must still reject the complete status snapshot.
        if (await worktreePathIsMissing(wt.path)) return null
        throw error
      }
      options?.signal?.throwIfAborted()
      const entries = parseStatus(output)
      return {
        path: wt.path,
        branch: wt.branch,
        isMain: wt.isPrimary,
        entries,
      }
    },
    { signal: options?.signal },
  )

  options?.signal?.throwIfAborted()
  const filtered = results.filter((x): x is WorktreeStatus => x !== null)
  // Main worktree first; the rest keep `git worktree list`'s order
  // (creation order — stable and matches what `git worktree list` shows
  // in the terminal).
  filtered.sort((a, b) => Number(b.isMain) - Number(a.isMain))
  return filtered
}
