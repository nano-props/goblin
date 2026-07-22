// Pure parsers for the raw stdout of various `git` invocations. Kept
// free of any I/O so they're trivially testable — the unit tests feed
// hand-crafted git output and assert the resulting domain objects.
//
// Each parser is paired with the exact git command it expects in a
// JSDoc comment; if a callsite changes the command (different format
// string, removed flag), the parser must be updated in lockstep.

import path from 'node:path'
import type { BranchSnapshotInfo, LogEntry, StatusEntry, WorktreeInfo } from '#/shared/git-types.ts'
import { GIT_HASH_RE } from '#/shared/git-types.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'

/** NUL cannot occur in Git's formatted ref/log fields. */
export const FIELD_SEP = '\0'
export const FOR_EACH_REF_FIELD_SEP = '%00'
export const PRETTY_FIELD_SEP = '%x00'

/**
 * Parse `git for-each-ref --format=<fields joined by FIELD_SEP> refs/heads/`.
 * Fields, in order: refname:short, objectname, objectname:short, subject,
 * authordate:iso-strict, authorname, upstream:short, upstream:track.
 */
export function parseBranches(
  output: string,
  currentBranch: string,
  worktrees: WorktreeInfo[] = [],
): BranchSnapshotInfo[] {
  if (!output) return []

  const lines = output.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parts = line.split(FIELD_SEP)
    if (parts.length !== 8) throw new Error('Invalid branch snapshot row')
    const [name, hash, shortHash, , date, , upstream, track] = parts
    if (!name || !isSafeBranchName(name) || !hash || !GIT_HASH_RE.test(hash)) {
      throw new Error('Invalid branch snapshot identity')
    }
    if (
      !shortHash ||
      !GIT_HASH_RE.test(shortHash) ||
      !date ||
      Number.isNaN(Date.parse(date)) ||
      (upstream !== '' && (!upstream || !isSafeBranchName(upstream))) ||
      !/^(?:|\[(?:gone|ahead \d+|behind \d+|ahead \d+, behind \d+)\])$/.test(track ?? '') ||
      (!upstream && track !== '')
    ) {
      throw new Error('Invalid branch snapshot metadata')
    }
  }

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

  const branches: BranchSnapshotInfo[] = []

  for (const line of lines) {
    const parts = line.split(FIELD_SEP)
    const name = parts[0] ?? ''
    const hash = parts[1] ?? ''
    const shortHash = parts[2] ?? ''
    const subject = parts[3] ?? ''
    const date = parts[4] ?? ''
    const author = parts[5] ?? ''
    const upstream = parts[6] ?? ''
    const track = parts[7] ?? ''

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
      lastCommitShortHash: shortHash,
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
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(FIELD_SEP)
      if (parts.length !== 6) throw new Error('Invalid log row')
      const [hash, shortHash, refs, message, author, date] = parts
      if (
        !hash ||
        !GIT_HASH_RE.test(hash) ||
        !shortHash ||
        !GIT_HASH_RE.test(shortHash) ||
        !date ||
        Number.isNaN(Date.parse(date))
      ) {
        throw new Error('Invalid log metadata')
      }
      return {
        hash,
        shortHash,
        refs: refs ?? '',
        message: message ?? '',
        author: author ?? '',
        date,
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
  if (!output.endsWith('\0')) throw new Error('Invalid status output')
  const records = output.split('\0')
  records.pop()
  const entries: StatusEntry[] = []
  for (let i = 0; i < records.length; i++) {
    const line = records[i]!
    if (line.length < 4 || line[2] !== ' ' || line.slice(3).length === 0) throw new Error('Invalid status record')
    const x = line[0]!
    const y = line[1]!
    if (!' MADRCUT?!'.includes(x) || !' MADRCUT?!'.includes(y)) throw new Error('Invalid status code')
    const path = line.slice(3)
    if (x === 'R' || x === 'C') {
      if (!records[i + 1]) throw new Error('Invalid status rename record')
      i++
    }
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
  const initialMarker = `${WORKTREE_STATUS_BATCH_BOUNDARY}\n`
  const followingMarker = `\n${initialMarker}`
  const startsWithMarker = output.startsWith(initialMarker)
  const idx = startsWithMarker ? 0 : output.indexOf(followingMarker)
  const markerLength = startsWithMarker ? initialMarker.length : followingMarker.length
  if (idx < 0) throw new Error('Invalid worktree status envelope')
  return {
    worktreeListOutput: output.slice(0, idx),
    statusStream: output.slice(idx + markerLength),
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
  if (!stream.endsWith('\0')) throw new Error('Invalid worktree status batch')
  const records = stream.split('\0')
  records.pop()
  if (records.pop() !== '') throw new Error('Invalid worktree status batch')
  let i = 0
  while (i < records.length) {
    const worktreePath = records[i] ?? ''
    i++
    if (!path.posix.isAbsolute(worktreePath) || result.has(worktreePath)) {
      throw new Error('Invalid worktree status path')
    }
    const statusRecords: string[] = []
    let complete = false
    while (i < records.length) {
      const rec = records[i] ?? ''
      i++
      if (rec === '') {
        complete = true
        break
      }
      statusRecords.push(rec)
    }
    if (!complete) throw new Error('Invalid worktree status section')
    const entries = statusRecords.length > 0 ? parseStatus(`${statusRecords.join('\0')}\0`) : []
    result.set(worktreePath, entries)
  }
  return result
}

/** Parse and validate the complete porcelain protocol into usable worktrees. */
export function parseWorktrees(output: string): WorktreeInfo[] {
  if (output.trim().length === 0) return []
  const blocks = output.split('\n\n').filter((block) => block.length > 0)
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0)
    let worktreeCount = 0
    let headCount = 0
    let stateCount = 0
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        worktreeCount += 1
        const worktreePath = line.slice('worktree '.length)
        if (!path.posix.isAbsolute(worktreePath) && !path.win32.isAbsolute(worktreePath)) {
          throw new Error('Invalid worktree path')
        }
      } else if (line.startsWith('HEAD ')) {
        headCount += 1
        if (!GIT_HASH_RE.test(line.slice('HEAD '.length))) throw new Error('Invalid worktree HEAD')
      } else if (line.startsWith('branch refs/heads/')) {
        stateCount += 1
        if (!isSafeBranchName(line.slice('branch refs/heads/'.length))) throw new Error('Invalid worktree branch')
      } else if (line === 'detached' || line === 'bare') {
        stateCount += 1
      } else if (
        line === 'locked' ||
        line.startsWith('locked ') ||
        line === 'prunable' ||
        line.startsWith('prunable ')
      ) {
        continue
      } else {
        throw new Error('Invalid worktree record')
      }
    }
    const bare = lines.includes('bare')
    if (worktreeCount !== 1 || stateCount !== 1 || (bare ? headCount !== 0 : headCount !== 1)) {
      throw new Error('Invalid worktree block')
    }
  }
  const worktrees: WorktreeInfo[] = []
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split('\n').filter((line) => line.length > 0)
    const worktreeLine = lines.find((line) => line.startsWith('worktree '))!
    const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'))
    const isPrunable = lines.some((line) => line === 'prunable' || line.startsWith('prunable '))
    if (isPrunable) continue
    worktrees.push({
      path: worktreeLine.slice('worktree '.length),
      ...(branchLine ? { branch: branchLine.slice('branch refs/heads/'.length) } : {}),
      isBare: lines.includes('bare'),
      isPrimary: blockIndex === 0,
      isLocked: lines.some((line) => line === 'locked' || line.startsWith('locked ')),
    })
  }
  return worktrees
}
