import path from 'node:path'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/system/git/branches.ts'
import { parseBranches, parseStatus, parseWorktrees } from '#/system/git/parsers.ts'
import { repoRemoteInfoForRemotes } from '#/system/git/remote.ts'
import {
  REMOTE_SNAPSHOT_BRANCHES_MARKER,
  REMOTE_SNAPSHOT_CURRENT_MARKER,
  REMOTE_SNAPSHOT_DEFAULT_MARKER,
  type RemoteCommandResult,
} from '#/system/ssh/commands.ts'
import type { BranchSnapshotInfo, ExecResult, RepoRemoteInfo, WorktreeInfo } from '#/shared/git-types.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { compactWorktreeBootstrapPaths, type WorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'

export interface RemoteRepoSnapshot {
  branches: BranchSnapshotInfo[]
  current: string
  remote: RepoRemoteInfo
}

interface SnapshotSections {
  current: string[]
  defaultBranch: string[]
  branches: string[]
}

export function parseRemoteSnapshot(output: string, worktrees: WorktreeInfo[] = []): RemoteRepoSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = singleOptionalBranchName(sections.current)
  const defaultBranch = singleOptionalBranchName(sections.defaultBranch)
  if (current === null || defaultBranch === null) return null
  const branchOutput = sections.branches.join('\n')
  let branches: BranchSnapshotInfo[]
  try {
    branches = parseBranches(branchOutput, current, worktrees)
  } catch {
    return null
  }
  const markedBranches = markDefaultBranch(branches, defaultBranch)
  return {
    branches: prioritizeDefaultBranch(markedBranches, defaultBranch),
    current,
    remote: repoRemoteInfoForRemotes([]),
  }
}

export function parseRemoteCurrentBranch(output: string): string | null {
  const sections = splitSnapshotSections(output)
  return sections ? singleOptionalBranchName(sections.current) : null
}

function singleOptionalBranchName(lines: readonly string[]): string | null {
  if (lines.length !== 1 || !lines[0]!.startsWith('value ')) return null
  const value = lines[0]!.slice('value '.length)
  return value === '' || isSafeBranchName(value) ? value : null
}

function splitSnapshotSections(output: string): SnapshotSections | null {
  const sections: SnapshotSections = { current: [], defaultBranch: [], branches: [] }
  const markers = [
    [REMOTE_SNAPSHOT_CURRENT_MARKER, 'current'],
    [REMOTE_SNAPSHOT_DEFAULT_MARKER, 'defaultBranch'],
    [REMOTE_SNAPSHOT_BRANCHES_MARKER, 'branches'],
  ] as const
  let nextMarker = 0
  let active: keyof SnapshotSections | null = null
  for (const line of output.split('\n')) {
    const markerIndex = markers.findIndex(([marker]) => marker === line)
    if (markerIndex >= 0) {
      if (markerIndex !== nextMarker) return null
      active = markers[markerIndex]![1]
      nextMarker += 1
      continue
    }
    if (!active) {
      if (line.trim().length > 0) return null
      continue
    }
    sections[active].push(line)
  }
  return nextMarker === markers.length ? sections : null
}

export function parseRemoteRepoCommonDir(output: string): string | null {
  const fields = output.split('\0')
  if (fields.length !== 2 || fields[1] !== '' || !fields[0]?.startsWith('/')) return null
  return path.posix.normalize(fields[0])
}

export function remoteBootstrapSummaryFromOutput(stdout: string): WorktreeBootstrapSummary {
  const copy: string[] = []
  const symlink: string[] = []
  const hardlink: string[] = []
  const missing: string[] = []
  let setup: string | undefined
  for (const line of stdout.split('\n')) {
    const [marker, ...rest] = line.split(' ')
    const value = rest.join(' ')
    switch (marker) {
      case 'GOBLIN_BOOTSTRAP_COPY':
        copy.push(value)
        break
      case 'GOBLIN_BOOTSTRAP_SYMLINK':
        symlink.push(value)
        break
      case 'GOBLIN_BOOTSTRAP_HARDLINK':
        hardlink.push(value)
        break
      case 'GOBLIN_BOOTSTRAP_MISSING':
        missing.push(value)
        break
      case 'GOBLIN_BOOTSTRAP_SETUP':
        setup = value
        break
    }
  }
  return {
    copy: compactWorktreeBootstrapPaths(copy),
    symlink: compactWorktreeBootstrapPaths(symlink),
    hardlink: compactWorktreeBootstrapPaths(hardlink),
    skippedMissing: compactWorktreeBootstrapPaths(missing),
    ...(setup ? { setup: { command: setup } } : {}),
  }
}

export function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}

export function isValidRemotePath(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && path.posix.isAbsolute(value)
}

export function decodeRemoteWorktrees(output: string): WorktreeInfo[] {
  try {
    const worktrees = parseWorktrees(output)
    if (worktrees.some((worktree) => !isValidRemotePath(worktree.path))) throw new Error('Invalid remote worktree path')
    return worktrees
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

export function decodeRemoteStatus(output: string) {
  try {
    return parseStatus(output)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}
