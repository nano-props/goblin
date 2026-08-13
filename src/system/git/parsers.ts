// Pure parsers for the raw stdout of various `git` invocations. Kept
// free of any I/O so they're trivially testable — the unit tests feed
// hand-crafted git output and assert the resulting domain objects.
//
// Each parser is paired with the exact git command it expects in a
// JSDoc comment; if a callsite changes the command (different format
// string, removed flag), the parser must be updated in lockstep.

import path from 'node:path'
import type { BranchSnapshotInfo, LogEntry, StatusEntry, WorktreeInfo } from '#/shared/git-types.ts'
import { GIT_OBJECT_ID_OR_PREFIX_RE, GIT_OBJECT_ID_RE, isFullGitObjectId } from '#/shared/git-types.ts'
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
export function parseBranches(output: string): BranchSnapshotInfo[] {
  if (!output) return []

  const lines = output.split('\n').filter((line) => line.length > 0)
  const branchNames = new Set<string>()
  for (const line of lines) {
    const parts = line.split(FIELD_SEP)
    if (parts.length !== 8) throw new Error('Invalid branch snapshot row')
    const [name, hash, shortHash, , date, , upstream, track] = parts
    if (!name || !isSafeBranchName(name) || !hash || !isFullGitObjectId(hash)) {
      throw new Error('Invalid branch snapshot identity')
    }
    if (branchNames.has(name)) throw new Error('Duplicate branch snapshot identity')
    branchNames.add(name)
    if (
      !shortHash ||
      !GIT_OBJECT_ID_OR_PREFIX_RE.test(shortHash) ||
      !date ||
      Number.isNaN(Date.parse(date)) ||
      (upstream !== '' && (!upstream || !isSafeBranchName(upstream))) ||
      !/^(?:|\[(?:gone|ahead \d+|behind \d+|ahead \d+, behind \d+)\])$/.test(track ?? '') ||
      (!upstream && track !== '')
    ) {
      throw new Error('Invalid branch snapshot metadata')
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
        !isFullGitObjectId(hash) ||
        !shortHash ||
        !GIT_OBJECT_ID_OR_PREFIX_RE.test(shortHash) ||
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
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      if (!records[i + 1]) throw new Error('Invalid status rename record')
      i++
    }
    entries.push({ x, y, path })
  }
  return entries
}

export type GitPathPlatform = 'posix' | 'win32'

export function normalizeGitPath(value: string, platform: GitPathPlatform): string {
  return platform === 'win32' ? path.win32.normalize(value.replaceAll('/', '\\')) : path.posix.normalize(value)
}

/** Parse and validate `git worktree list --porcelain -z`. */
export function parseWorktrees(output: string, platform: GitPathPlatform = 'posix'): WorktreeInfo[] {
  if (output.length === 0) throw new Error('Invalid worktree output')
  if (!output.endsWith('\0\0')) throw new Error('Invalid worktree output')
  const blocks = output.slice(0, -2).split('\0\0')
  for (const block of blocks) {
    const lines = block.split('\0')
    if (lines.some((line) => line.length === 0)) throw new Error('Invalid worktree record')
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
        if (!GIT_OBJECT_ID_RE.test(line.slice('HEAD '.length))) throw new Error('Invalid worktree HEAD')
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
  const worktreePaths = new Set<string>()
  for (const [blockIndex, block] of blocks.entries()) {
    const lines = block.split('\0')
    const worktreeLine = lines.find((line) => line.startsWith('worktree '))!
    const headLine = lines.find((line) => line.startsWith('HEAD '))
    const branchLine = lines.find((line) => line.startsWith('branch refs/heads/'))
    const isPrunable = lines.some((line) => line === 'prunable' || line.startsWith('prunable '))
    if (isPrunable) continue
    const worktreePath = normalizeGitPath(worktreeLine.slice('worktree '.length), platform)
    if (worktreePaths.has(worktreePath)) throw new Error('Duplicate worktree path')
    worktreePaths.add(worktreePath)
    worktrees.push({
      path: worktreePath,
      ...(headLine ? { headOid: gitWorktreeHeadOid(headLine.slice('HEAD '.length)) } : {}),
      ...(branchLine ? { branch: branchLine.slice('branch refs/heads/'.length) } : {}),
      isBare: lines.includes('bare'),
      isPrimary: blockIndex === 0,
      isLocked: lines.some((line) => line === 'locked' || line.startsWith('locked ')),
    })
  }
  return worktrees
}

function gitWorktreeHeadOid(value: string): string | null {
  return /^0+$/u.test(value) ? null : value
}
