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
import type {
  BranchSnapshotInfo,
  ExecResult,
  GitOperation,
  RepoRemoteInfo,
  RepoWorktreeSnapshot,
  WorktreeInfo,
} from '#/shared/git-types.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { compactWorktreeBootstrapPaths, type WorktreeBootstrapSummary } from '#/shared/worktree-bootstrap-summary.ts'
import { decodeRemoteWorktreeBootstrapRecords } from '#/system/ssh/worktree-bootstrap-protocol.ts'

export interface RemoteRepoBaseSnapshot {
  branches: BranchSnapshotInfo[]
  current: string
  remote: RepoRemoteInfo
}

export interface RemoteRepoSnapshot extends RemoteRepoBaseSnapshot {
  worktrees: RepoWorktreeSnapshot[]
}

export interface RemoteGitWorktreeState {
  operation: GitOperation | null
  materializedBranch: string | null
}

export function decodeRemoteGitWorktreeState(output: string): RemoteGitWorktreeState {
  const [operationRecord, branchRecord, ...extra] = output.trimEnd().split('\n')
  if (
    extra.length > 0 ||
    !operationRecord?.startsWith('operation ') ||
    (branchRecord !== 'materialized-branch' && !branchRecord?.startsWith('materialized-branch '))
  ) {
    throw new Error('error.failed-read-repo')
  }
  const kind = operationRecord.slice('operation '.length)
  const operation = decodeGitOperationKind(kind)
  const rawBranchName = branchRecord === 'materialized-branch' ? '' : branchRecord.slice('materialized-branch '.length)
  if (operation?.kind === 'rebase' && rawBranchName) {
    if (!rawBranchName.startsWith('refs/heads/')) throw new Error('error.failed-read-repo')
  } else if (rawBranchName.startsWith('refs/heads/')) {
    throw new Error('error.failed-read-repo')
  }
  const branchName = rawBranchName.startsWith('refs/heads/') ? rawBranchName.slice('refs/heads/'.length) : rawBranchName
  if (rawBranchName && !branchName) throw new Error('error.failed-read-repo')
  const materializedBranch = branchName || null
  if (materializedBranch && !isSafeBranchName(materializedBranch)) throw new Error('error.failed-read-repo')
  return { operation, materializedBranch }
}

function decodeGitOperationKind(kind: string): GitOperation | null {
  if (kind === 'none') return null
  if (kind === 'rebase' || kind === 'cherry-pick' || kind === 'revert' || kind === 'bisect' || kind === 'merge') {
    return { kind }
  }
  throw new Error('error.failed-read-repo')
}

interface SnapshotSections {
  current: string[]
  defaultBranch: string[]
  branches: string[]
}

export function parseRemoteSnapshot(output: string): RemoteRepoBaseSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = singleOptionalBranchName(sections.current)
  const defaultBranch = singleOptionalBranchName(sections.defaultBranch)
  if (current === null || defaultBranch === null) return null
  const branchOutput = sections.branches.join('\n')
  let branches: BranchSnapshotInfo[]
  try {
    branches = parseBranches(branchOutput)
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
  for (const record of decodeRemoteWorktreeBootstrapRecords(stdout)) {
    switch (record.kind) {
      case 'copy':
        copy.push(record.value)
        break
      case 'symlink':
        symlink.push(record.value)
        break
      case 'hardlink':
        hardlink.push(record.value)
        break
      case 'missing':
        missing.push(record.value)
        break
      case 'setup':
        setup = record.value
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
