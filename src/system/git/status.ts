import { git } from '#/system/git/helper.ts'
import { parseStatus, parseWorktrees } from '#/system/git/parsers.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

const WORKTREE_STATUS_CONCURRENCY = 16

/** Status for the Status tab — grouped by worktree so multi-worktree
 *  setups see *all* dirty changes, not just the main worktree's. The
 *  main worktree (the one matching `cwd`) sorts first.
 *
 *  We list worktrees with `git worktree list` and run `git status` in
 *  each in parallel. Bare worktrees and worktrees that fail to status
 *  (drive unmounted, permissions) are skipped silently. */
export async function getWorkingStatus(cwd: string, options?: { signal?: AbortSignal }): Promise<WorktreeStatus[]> {
  let worktrees
  try {
    const out = await git(cwd, ['worktree', 'list', '--porcelain'], { signal: options?.signal })
    if (options?.signal?.aborted) return []
    worktrees = parseWorktrees(out)
  } catch {
    if (options?.signal?.aborted) return []
    return []
  }

  const results = await mapWithConcurrency(
    worktrees,
    WORKTREE_STATUS_CONCURRENCY,
    async (wt): Promise<WorktreeStatus | null> => {
      if (wt.isBare) return null
      try {
        // -z: NUL-terminated entries with quoting disabled. Without this,
        // filenames containing spaces, quotes, or unicode get backslash-
        // escaped and double-quoted (e.g. `"file name.txt"`), which the LF
        // parser leaves as literal quotes in the output. -z gives us the
        // raw bytes and uses NUL between entries.
        const output = await git(wt.path, ['status', '--porcelain', '-z'], { signal: options?.signal })
        if (options?.signal?.aborted) return null
        const entries = parseStatus(output)
        return {
          path: wt.path,
          branch: wt.branch,
          head: wt.head,
          isMain: wt.isPrimary,
          entries,
        }
      } catch {
        return null
      }
    },
    { signal: options?.signal },
  )

  if (options?.signal?.aborted) return []
  const filtered = results.filter((x): x is WorktreeStatus => x !== null)
  // Main worktree first; the rest keep `git worktree list`'s order
  // (creation order — stable and matches what `git worktree list` shows
  // in the terminal).
  filtered.sort((a, b) => Number(b.isMain) - Number(a.isMain))
  return filtered
}
