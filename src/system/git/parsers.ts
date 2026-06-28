// Pure parsers for the raw stdout of various `git` invocations. Kept
// free of any I/O so they're trivially testable — the unit tests feed
// hand-crafted git output and assert the resulting domain objects.
//
// Each parser is paired with the exact git command it expects in a
// JSDoc comment; if a callsite changes the command (different format
// string, removed flag), the parser must be updated in lockstep.

import type { BranchSnapshotInfo, LogEntry, StatusEntry, WorktreeInfo } from '#/shared/git-types.ts'

/** ASCII Unit Separator. Safe against subjects / author names / paths
 *  containing it. Used by both the branch and log format strings. */
export const FIELD_SEP = '\x1f'

/**
 * Parse `git for-each-ref --format=<fields joined by FIELD_SEP> refs/heads/`.
 * Fields, in order: refname:short, objectname:short, subject,
 * authordate:iso-strict, authorname, upstream:short, upstream:track.
 */
export function parseBranches(
  output: string,
  currentBranch: string,
  worktrees: WorktreeInfo[] = [],
): BranchSnapshotInfo[] {
  if (!output) return []

  const worktreeMap = new Map<
    string,
    { path: string; isDirty?: boolean; isPrimary: boolean; changeCount?: number; isLocked?: boolean }
  >()
  for (const wt of worktrees) {
    if (wt.branch) {
      worktreeMap.set(wt.branch, {
        path: wt.path,
        isDirty: wt.isDirty,
        isPrimary: wt.isPrimary,
        changeCount: wt.changeCount,
        isLocked: wt.isLocked,
      })
    }
  }

  const lines = output.split('\n').filter(Boolean)
  const branches: BranchSnapshotInfo[] = []

  for (const line of lines) {
    const parts = line.split(FIELD_SEP)
    const name = parts[0] ?? ''
    const hash = parts[1] ?? ''
    const subject = parts[2] ?? ''
    const date = parts[3] ?? ''
    const author = parts[4] ?? ''
    const upstream = parts[5] ?? ''
    const track = parts[6] ?? ''

    let ahead = 0
    let behind = 0
    const aheadMatch = track.match(/ahead (\d+)/)
    const behindMatch = track.match(/behind (\d+)/)
    if (aheadMatch) ahead = parseInt(aheadMatch[1] ?? '0', 10)
    if (behindMatch) behind = parseInt(behindMatch[1] ?? '0', 10)

    const branchInfo: BranchSnapshotInfo = {
      name,
      isCurrent: name === currentBranch,
      ahead,
      behind,
      lastCommitHash: hash,
      lastCommitMessage: subject,
      lastCommitDate: date,
      lastCommitAuthor: author,
    }

    if (upstream) {
      branchInfo.tracking = upstream
      branchInfo.trackingGone = track.includes('gone')
    }

    const wtInfo = worktreeMap.get(name)
    if (wtInfo) {
      const hasSummary = wtInfo.isDirty !== undefined || wtInfo.changeCount !== undefined
      branchInfo.worktree = {
        path: wtInfo.path,
        isPrimary: wtInfo.isPrimary,
        ...(wtInfo.isLocked !== undefined ? { isLocked: wtInfo.isLocked } : {}),
        ...(hasSummary
          ? {
              summary: {
                ...(wtInfo.isDirty !== undefined ? { dirty: wtInfo.isDirty } : {}),
                ...(wtInfo.changeCount !== undefined ? { changeCount: wtInfo.changeCount } : {}),
              },
            }
          : {}),
      }
    }

    branches.push(branchInfo)
  }

  return branches
}

/**
 * Parse `git log --format=<%H, %h, %D, %s, %an, %aI joined by FIELD_SEP>`.
 */
export function parseLog(output: string): LogEntry[] {
  if (!output) return []
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(FIELD_SEP)
      return {
        hash: parts[0] ?? '',
        shortHash: parts[1] ?? '',
        refs: parts[2] ?? '',
        message: parts[3] ?? '',
        author: parts[4] ?? '',
        date: parts[5] ?? '',
      }
    })
}

/**
 * Parse `git status --porcelain -z`. -z gives NUL-terminated entries
 * with quoting disabled — needed to handle filenames with spaces /
 * quotes / unicode without manual unescaping.
 *
 * Rename and copy entries occupy TWO records: the new path first,
 * then the original path. We surface the new path (matching what
 * non-z `git status` shows the user) and discard the original.
 */
export function parseStatus(output: string): StatusEntry[] {
  if (!output) return []
  const records = output.split('\0').filter((s) => s.length > 0)
  const entries: StatusEntry[] = []
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!
    if (line.length < 3) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const path = line.slice(3)
    if (x === 'R' || x === 'C') i++
    entries.push({ x, y, path })
  }
  return entries
}

/** Marker separating the worktree-list porcelain block from the
 *  per-worktree NUL-batched status stream in
 *  `gitWorktreeListAndStatus` output. The marker is emitted on its
 *  own line by the remote script (`printf '\n%s\n' '...'`), and
 *  `splitWorktreeStatusBatch` searches for it wrapped in surrounding
 *  newlines. The literal text inside is unique enough that it
 *  cannot collide with a `git worktree list --porcelain` line --
 *  every line in that output is prefixed by a keyword (`worktree`,
 *  `HEAD`, `branch`, `detached`, `bare`, or `locked`) so the bare
 *  marker text is never produced as a standalone line. */
export const WORKTREE_STATUS_BATCH_BOUNDARY = '__GOBLIN_WT_BATCH_BOUNDARY__'

/**
 * Split a `gitWorktreeListAndStatus` raw stdout into the worktree-list
 * block and the per-worktree status stream. The two are separated by
 * a literal newline + boundary marker + newline sequence. Returns
 * `{ worktreeListOutput, statusStream }`; pass each through
 * `parseWorktrees` and `parseWorktreeStatusBatch` respectively.
 */
export function splitWorktreeStatusBatch(output: string): {
  readonly worktreeListOutput: string
  readonly statusStream: string
} {
  const marker = `\n${WORKTREE_STATUS_BATCH_BOUNDARY}\n`
  const idx = output.indexOf(marker)
  if (idx < 0) {
    // Defensive: if the remote shell could not produce the batch
    // (e.g. a very old bash) we fall back to an empty status stream
    // and treat the whole output as the worktree list, so the
    // caller can still produce a worktree list from it.
    return { worktreeListOutput: output, statusStream: '' }
  }
  return {
    worktreeListOutput: output.slice(0, idx),
    statusStream: output.slice(idx + marker.length),
  }
}

/**
 * Parse the per-worktree status stream of `gitWorktreeListAndStatus`.
 * The stream is a sequence of NUL-separated records laid out as:
 *
 *   <path1>\0<status records>\0<path2>\0<status records>\0...
 *
 * Each section begins with a NUL-terminated worktree path (as emitted
 * by `git rev-parse --show-toplevel` from the script) and ends with
 * an empty NUL record. Walk NUL-split records: read a path, then
 * collect status records until the next empty record. The empty
 * record between sections is the worktree boundary.
 *
 * Returns a Map keyed by the worktree path. Empty status is encoded
 * as a path mapped to an empty array (a clean worktree).
 */
export function parseWorktreeStatusBatch(stream: string): ReadonlyMap<string, ReadonlyArray<StatusEntry>> {
  const result = new Map<string, ReadonlyArray<StatusEntry>>()
  if (!stream) return result
  const records = stream.split('\0')
  let i = 0
  while (i < records.length) {
    const path = records[i] ?? ''
    i++
    if (path === '') break // trailing empty record (or end-of-stream)
    const entries: StatusEntry[] = []
    while (i < records.length) {
      const rec = records[i] ?? ''
      i++
      if (rec === '') break // worktree boundary
      if (rec.length < 3) continue
      const x = rec[0] ?? ' '
      const y = rec[1] ?? ' '
      const filePath = rec.slice(3)
      if (x === 'R' || x === 'C') {
        // Skip the second NUL-terminated record holding the original
        // path. We surface only the new path to match `parseStatus`.
        i++
      }
      entries.push({ x, y, path: filePath })
    }
    result.set(path, entries)
  }
  return result
}

/**
 * Parse `git worktree list --porcelain`. Blocks are separated by a
 * blank line; each block contains `worktree <path>` and either a
 * `branch refs/heads/<name>` line, a `detached` marker, or a `bare`
 * marker. Dirtiness is filled in later by `getWorktrees` because it
 * requires running another git command per worktree.
 */
export function parseWorktrees(output: string): WorktreeInfo[] {
  if (!output) return []
  const worktrees: WorktreeInfo[] = []
  const blocks = output.split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean)
    let path = ''
    let branch: string | undefined
    let isBare = false
    let isLocked = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length)
        branch = ref.replace(/^refs\/heads\//, '')
      } else if (line === 'bare') {
        isBare = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true
      }
    }

    if (path) worktrees.push({ path, branch, isBare, isPrimary: worktrees.length === 0, isLocked })
  }

  return worktrees
}
