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
export function parseBranches(output: string, currentBranch: string, worktrees: WorktreeInfo[] = []): BranchSnapshotInfo[] {
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
 * Parse `git log --format=<%H, %h, %s, %an, %aI joined by FIELD_SEP>`.
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
        message: parts[2] ?? '',
        author: parts[3] ?? '',
        date: parts[4] ?? '',
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
