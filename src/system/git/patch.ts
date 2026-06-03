// Build an "apply-equivalent" patch for a worktree — the on-disk
// state vs HEAD, plus untracked files, in a format `git apply --binary`
// can replay on another machine. Roughly equivalent to:
//   (cd <worktree> && git diff HEAD --binary && \
//     <for each untracked file>: git diff --binary --no-index /dev/null <file>)
//
// Why this shape:
//   - `git diff HEAD` covers staged + unstaged tracked changes in one
//     pass — matches what users mentally model as "everything I haven't
//     committed yet".
//   - `--binary` produces literal base85-encoded blocks for binary
//     files; without it, binaries become "Binary files differ" and
//     can't be reapplied.
//   - Untracked files don't show up in `git diff` at all; we run a
//     per-file `--no-index` diff against /dev/null which produces a
//     standard `new file` patch block. This avoids the side-effects of
//     `git add -N` (which would mutate the index just to make a diff
//     readable).
//
// Cancellation / timeout: each git invocation uses the default helper
// timeout. For a worktree with hundreds of untracked files this can be
// slow; we run untracked diffs with bounded concurrency and let the
// caller's IPC timeout bound the whole thing.

import { execa } from 'execa'
import { git } from '#/system/git/helper.ts'
import { parseStatus } from '#/system/git/parsers.ts'
import { mapWithConcurrency } from '#/system/git/concurrency.ts'

// Cap concurrent `git diff --no-index` invocations. Without a cap a
// worktree with thousands of untracked files would fork that many git
// processes at once — which OOMs / hits the OS process-table limit
// before the IPC timeout fires. 16 is comfortably below ulimit defaults
// and saturates a typical SSD without becoming the bottleneck.
const UNTRACKED_DIFF_CONCURRENCY = 16

/** Returns the assembled patch text, or empty string when the worktree
 *  has no changes. Throws if the underlying git diff fails for an
 *  unexpected reason. */
export async function getWorktreePatch(worktreePath: string, options?: { signal?: AbortSignal }): Promise<string> {
  const signal = options?.signal
  // Tracked: staged + unstaged in a single pass.
  const trackedPatch = await git(worktreePath, ['diff', 'HEAD', '--binary'], { signal })

  // Untracked: -uall expands untracked directories into their member
  // files. Without it, an untracked `subdir/` is reported as a single
  // entry, but `git diff --no-index /dev/null subdir/` doesn't work
  // (no-index expects two file paths). With -uall we get one entry per
  // file and each diff invocation succeeds.
  const statusOut = await git(worktreePath, ['status', '--porcelain', '-z', '-uall'], { signal })
  const entries = parseStatus(statusOut)
  const untrackedPaths = entries.filter((e) => e.x === '?' && e.y === '?').map((e) => e.path)

  // `git diff --no-index` exits with code 1 when the files differ — that's
  // success for us, we want the diff. Our helper currently throws on any
  // non-zero exit, so we route it through safeDiffNoIndex which treats
  // exit 1 as success.
  const untrackedPatches = await mapWithConcurrency(
    untrackedPaths,
    UNTRACKED_DIFF_CONCURRENCY,
    async (p) => {
      const patch = await safeDiffNoIndex(worktreePath, p, signal)
      if (patch === null) throw new Error(`Failed to diff untracked file: ${p}`)
      return patch
    },
    { signal, abort: 'throw' },
  )

  const combined = [trackedPatch, ...untrackedPatches].filter((s) => s.length > 0).join('\n')
  if (signal?.aborted) throw new Error('cancelled')
  // Guarantee a trailing newline — `git apply` tolerates either, but a
  // trailing newline is what `git format-patch` produces and what most
  // tools (`pbpaste | git apply`) expect.
  return combined.length > 0 ? `${combined}\n` : ''
}

/** Run `git diff --binary --no-index /dev/null <file>` and return its
 *  output. Treats exit code 1 (files differ — i.e. there's a diff) as
 *  success. Returns null on any other failure so the caller can fail
 *  the whole patch rather than silently dropping a file. */
async function safeDiffNoIndex(cwd: string, relativePath: string, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) throw new Error('cancelled')
  const result = await execa('git', ['diff', '--binary', '--no-index', '--', '/dev/null', relativePath], {
    cwd,
    timeout: 30_000,
    cancelSignal: signal,
    forceKillAfterDelay: 500,
    maxBuffer: 10 * 1024 * 1024,
    reject: false,
  })
  if (signal?.aborted || result.isCanceled) throw new Error('cancelled')
  if (result.exitCode === 0 || result.exitCode === 1) return result.stdout.trimEnd()
  return null
}
