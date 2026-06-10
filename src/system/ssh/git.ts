import path from 'node:path'
import { parseBranches, parseLog, parseStatus, parseWorktrees } from '#/system/git/parsers.ts'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/system/git/branches.ts'
import {
  getBrowserRemoteUrlForRemotes,
  getNewPullRequestUrlForRemotes,
  parseRemoteVerbose,
  repoRemoteInfoForRemotes,
  resolveFetchRemoteForRemotes,
  resolvePushTargetForRemotes,
  type UpstreamParts,
} from '#/system/git/remote.ts'
import {
  REMOTE_SNAPSHOT_BRANCHES_MARKER,
  REMOTE_SNAPSHOT_CURRENT_MARKER,
  REMOTE_SNAPSHOT_DEFAULT_MARKER,
  runRemoteCommand,
  type RemoteCommandKind,
  type RemoteCommandResult,
} from '#/system/ssh/commands.ts'
import { type BranchSnapshotInfo, type ExecResult, type GitRemoteInfo, type LogEntry, type RepoRemoteInfo, type WorktreeInfo, type WorktreeStatus } from '#/shared/git-types.ts'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { normalizeCreateWorktreeInput, parseRemoteTrackingRefs, type CreateWorktreeInput } from '#/shared/worktree-create.ts'

type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteRepoTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

const REMOTE_WORKTREE_STATUS_CONCURRENCY = 8
const REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY = 8
const REMOTE_BRANCH_OP_TIMEOUT_MS = 180_000
const REMOTE_PATCH_TIMEOUT_MS = 90_000

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

export async function getRemoteSnapshot(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoSnapshot | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [result, worktrees] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteWorktrees(target, { signal: options.signal, run }),
  ])
  if (!result.ok) return null
  const snapshot = parseRemoteSnapshot(result.stdout, worktrees)
  if (!snapshot) return null
  const remote = await getRemoteRepoInfo(target, { signal: options.signal, run })
  return { ...snapshot, remote }
}

export async function getRemoteStatus(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeStatus[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: options.signal })
  if (!result.ok || options.signal?.aborted) return []
  const worktrees = parseWorktrees(result.stdout).filter((worktree) => !worktree.isBare)
  const statuses = await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree): Promise<WorktreeStatus | null> => {
      const status = await run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      if (options.signal?.aborted) return null
      if (!status.ok) return null
      return {
        path: worktree.path,
        branch: worktree.branch,
        head: worktree.head,
        isMain: worktree.isPrimary,
        entries: parseStatus(status.stdout),
      }
    },
    options.signal,
  )
  return statuses.filter((status): status is WorktreeStatus => status !== null)
}

export async function getRemoteLog(
  target: RemoteRepoTarget,
  branch: string,
  count?: number,
  skip?: number,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<LogEntry[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitLog', path: target.remotePath, branch, count, skip }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return []
  return parseLog(result.stdout)
}

export async function getRemotePatch(
  target: RemoteRepoTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, { signal: options.signal, run })
  if ('ok' in known) return known
  const tracked = await run({ type: 'gitPatch', path: known.path }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!tracked.ok) return remoteExecResult(tracked)

  const status = await run({ type: 'gitStatusAll', path: known.path }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)

  const untrackedPaths = parseStatus(status.stdout)
    .filter((entry) => entry.x === '?' && entry.y === '?')
    .map((entry) => entry.path)
  const untrackedPatches = await mapWithConcurrency(
    untrackedPaths,
    REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY,
    async (filePath): Promise<string | ExecResult> => {
      const result = await run({ type: 'gitDiffNoIndex', path: known.path, filePath }, target, {
        signal: options.signal,
        timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
      })
      if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
      return result.ok ? result.stdout : remoteExecResult(result)
    },
    options.signal,
  )
  const failedPatch = untrackedPatches.find((patch): patch is ExecResult => typeof patch !== 'string')
  if (failedPatch) return failedPatch
  const patchTexts = untrackedPatches.filter((patch): patch is string => typeof patch === 'string')
  const combined = [tracked.stdout, ...patchTexts].filter((part) => part.length > 0).join('\n')
  return { ok: true, message: combined.length > 0 ? `${combined}\n` : '' }
}

export async function fetchRemoteRepository(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const currentBranch = await getRemoteCurrentBranch(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, { signal: options.signal, run }),
    currentBranch ? getRemoteUpstreamParts(target, currentBranch, { signal: options.signal, run }) : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (remotes.length === 0) return { ok: true, message: '' }
  const remote = resolveFetchRemoteForRemotes(remotes, upstream)
  if (!remote) return { ok: true, message: '' }
  const result = await run({ type: 'gitFetchRemote', path: target.remotePath, remote }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
  })
  return remoteExecResult(result)
}

export async function checkoutRemoteBranch(
  target: RemoteRepoTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (worktreePath && !isValidRemotePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitCheckout', path: worktreePath ?? target.remotePath, branch },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function pullRemoteBranch(
  target: RemoteRepoTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (worktreePath && !isValidRemotePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (worktreePath) {
    const result = await run({ type: 'gitPullCurrent', path: worktreePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    return remoteExecResult(result)
  }

  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (snapshot?.current === branch) {
    const result = await run({ type: 'gitPullCurrent', path: target.remotePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    return remoteExecResult(result)
  }

  const upstream = await getRemoteUpstream(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!upstream) return { ok: false, message: 'error.invalid-arguments' }
  const targetParts = splitUpstream(upstream)
  if (!targetParts) return { ok: false, message: 'error.invalid-arguments' }
  const remotes = await getRemoteRemotes(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (targetParts.remote !== '.' && !remotes.some((remote) => remote.name === targetParts.remote)) {
    return { ok: false, message: 'error.pull-no-remote' }
  }
  const result = await run(
    { type: 'gitFetchBranch', path: target.remotePath, remote: targetParts.remote, remoteBranch: targetParts.branch, branch },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function pushRemoteBranch(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const pushTarget = await resolveRemotePushTarget(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if ('ok' in pushTarget) return pushTarget
  const result = await run(
    {
      type: 'gitPush',
      path: target.remotePath,
      remote: pushTarget.remote,
      branch,
      targetBranch: pushTarget.branch,
      setUpstream: pushTarget.setUpstream,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function createRemoteWorktree(
  target: RemoteRepoTarget,
  input: CreateWorktreeInput & { signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return { ok: false, message: 'error.invalid-arguments' }
  if (!isValidRemotePath(normalized.worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      input: normalized,
    },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function getRemoteTrackingBranches(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitRemoteBranches', path: target.remotePath }, target, { signal: options.signal })
  return result.ok ? parseRemoteTrackingRefs(result.stdout) : []
}

export async function removeRemoteWorktree(
  target: RemoteRepoTarget,
  input: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    signal?: AbortSignal
    run?: RemoteGitRunner
  },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)
  const worktrees = parseWorktrees(listResult.stdout)

  const resolved = resolveRemoteRemovableWorktree(
    worktrees,
    input.branch,
    input.worktreePath,
    target.remotePath,
  )
  if ('ok' in resolved) return resolved

  const status = await run({ type: 'gitStatus', path: resolved.path }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const statusAwareWorktree = !status.ok
    ? { ...resolved, isDirty: undefined }
    : { ...resolved, isDirty: parseStatus(status.stdout).length > 0 }
  const invalid = validateRemovableWorktreeState(statusAwareWorktree)
  if (invalid) return invalid

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  if (input.alsoDeleteBranch) {
    const currentBranch = await getRemoteCurrentBranch(target, { signal: input.signal, run })
    const mergeFacts = shouldForceDeleteBranch
      ? { mergedToCurrent: false, mergedToUpstream: false }
      : await getRemoteBranchMergeFacts(target, input.branch, {
          signal: input.signal,
          run,
          currentBranch,
        })
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    const validation = validateBranchDeletionPolicy({
      branch: input.branch,
      currentBranch,
      isCheckedOutElsewhere: worktrees.some((worktree) => worktree.branch === input.branch && worktree.path !== resolved.path),
      force: shouldForceDeleteBranch,
      mergedToCurrent: mergeFacts.mergedToCurrent,
      mergedToUpstream: mergeFacts.mergedToUpstream,
      notMergedMessage: 'error.cannot-remove-unpushed-worktree',
    })
    if (validation) return validation
  }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: target.remotePath, worktreePath: resolved.path },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!removeResult.ok) return remoteExecResult(removeResult)
  if (!input.alsoDeleteBranch) return remoteExecResult(removeResult)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(deleteResult)
}

export async function deleteRemoteBranch(
  target: RemoteRepoTarget,
  input: { branch: string; force?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const snapshot = await getRemoteSnapshot(target, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const shouldForce = input.force === true
  const mergeFacts = shouldForce
    ? { mergedToCurrent: false, mergedToUpstream: false }
    : await getRemoteBranchMergeFacts(target, input.branch, {
        signal: input.signal,
        run,
        currentBranch: snapshot?.current,
      })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const validation = validateBranchDeletionPolicy({
    branch: input.branch,
    currentBranch: snapshot?.current,
    isCheckedOutElsewhere: !!snapshot?.branches.some((branchInfo) => branchInfo.name === input.branch && branchInfo.worktree),
    force: shouldForce,
    mergedToCurrent: mergeFacts.mergedToCurrent,
    mergedToUpstream: mergeFacts.mergedToUpstream,
  })
  if (validation) return validation
  const result = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForce },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function getRemoteBrowserUrl(
  target: RemoteRepoTarget,
  branch?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [remoteInfo, upstream] = await Promise.all([
    getRemoteRepoInfo(target, { signal: options.signal, run }),
    branch ? getRemoteUpstreamParts(target, branch, { signal: options.signal, run }) : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return null
  return branch
    ? getNewPullRequestUrlForRemotes(remoteInfo.remotes, branch, upstream)
    : getBrowserRemoteUrlForRemotes(remoteInfo.remotes, upstream)
}

export function parseRemoteSnapshot(output: string, worktrees: WorktreeInfo[] = []): RemoteRepoSnapshot | null {
  const sections = splitSnapshotSections(output)
  if (!sections) return null
  const current = firstLine(sections.current)
  const defaultBranch = firstLine(sections.defaultBranch)
  const branchOutput = sections.branches.join('\n')
  const branches = parseBranches(branchOutput, current, worktrees)
  const markedBranches = markDefaultBranch(branches, defaultBranch)
  return {
    branches: prioritizeDefaultBranch(markedBranches, defaultBranch),
    current,
    remote: repoRemoteInfoForRemotes([]),
  }
}

async function getRemoteWorktrees(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return []
  const worktrees = parseWorktrees(result.stdout)
  await mapWithConcurrency(
    worktrees,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => {
      if (worktree.isBare) return
      const status = await options.run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      if (options.signal?.aborted) return
      if (!status.ok) {
        worktree.isDirty = undefined
        return
      }
      const entries = parseStatus(status.stdout)
      worktree.isDirty = entries.length > 0
      worktree.changeCount = entries.length
    },
    options.signal,
  )
  return worktrees
}

function splitSnapshotSections(output: string): SnapshotSections | null {
  const sections: SnapshotSections = { current: [], defaultBranch: [], branches: [] }
  let active: keyof SnapshotSections | null = null
  for (const line of output.split('\n')) {
    if (line === REMOTE_SNAPSHOT_CURRENT_MARKER) {
      active = 'current'
      continue
    }
    if (line === REMOTE_SNAPSHOT_DEFAULT_MARKER) {
      active = 'defaultBranch'
      continue
    }
    if (line === REMOTE_SNAPSHOT_BRANCHES_MARKER) {
      active = 'branches'
      continue
    }
    if (active) sections[active].push(line)
  }
  if (!output.includes(REMOTE_SNAPSHOT_BRANCHES_MARKER)) return null
  return sections
}

function firstLine(lines: string[]): string {
  return lines.find((line) => line.trim().length > 0)?.trim() ?? ''
}

async function resolveKnownRemoteWorktree(
  target: RemoteRepoTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo | ExecResult> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!result.ok) return remoteExecResult(result)
  const worktree = parseWorktrees(result.stdout).find((item) => item.path === worktreePath && !item.isBare)
  if (!worktree) return { ok: false, message: 'error.worktree-not-found' }
  return worktree
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  repoPath: string,
): WorktreeInfo | ExecResult {
  const target = worktrees.find((worktree) => worktree.path === worktreePath && worktree.branch === branch)
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (target.isPrimary || target.path === repoPath) return { ok: false, message: 'error.cannot-remove-main-worktree' }
  return target
}

async function getRemoteUpstream(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<string | null> {
  const result = await options.run({ type: 'gitUpstream', path: target.remotePath, branch }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return null
  return result.stdout.trim() || null
}

async function getRemoteRemotes(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<GitRemoteInfo[]> {
  const result = await options.run({ type: 'gitRemoteVerbose', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return []
  return parseRemoteVerbose(result.stdout)
}

async function getRemoteCurrentBranch(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<string> {
  const result = await options.run({ type: 'gitSnapshot', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (!result.ok || options.signal?.aborted) return ''
  const sections = splitSnapshotSections(result.stdout)
  return sections ? firstLine(sections.current) : ''
}

async function getRemoteUpstreamParts(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<UpstreamParts | null> {
  const upstream = await getRemoteUpstream(target, branch, options)
  return upstream ? splitUpstream(upstream) : null
}

async function getRemoteRepoInfo(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<RepoRemoteInfo> {
  return repoRemoteInfoForRemotes(await getRemoteRemotes(target, options))
}

async function getRemoteBranchMergeFacts(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner; currentBranch?: string },
): Promise<{ mergedToCurrent: boolean; mergedToUpstream: boolean }> {
  let mergedToCurrent = false
  if (options.currentBranch) {
    const result = await options.run(
      { type: 'gitIsAncestor', path: target.remotePath, ancestor: branch, descendant: options.currentBranch },
      target,
      { signal: options.signal },
    )
    mergedToCurrent = result.ok && !options.signal?.aborted
  }
  let mergedToUpstream = false
  const upstream = await getRemoteUpstream(target, branch, options)
  if (upstream && !options.signal?.aborted) {
    const result = await options.run(
      { type: 'gitIsAncestor', path: target.remotePath, ancestor: branch, descendant: upstream },
      target,
      { signal: options.signal },
    )
    mergedToUpstream = result.ok && !options.signal?.aborted
  }
  return { mergedToCurrent, mergedToUpstream }
}

async function resolveRemotePushTarget(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<{ remote: string; branch: string; setUpstream: boolean } | ExecResult> {
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, options),
    getRemoteUpstreamParts(target, branch, options),
  ])
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  return resolvePushTargetForRemotes(remotes, upstream, branch)
}

function splitUpstream(upstream: string): { remote: string; branch: string } | null {
  const slashIndex = upstream.indexOf('/')
  if (slashIndex <= 0 || slashIndex === upstream.length - 1) return null
  return {
    remote: upstream.slice(0, slashIndex),
    branch: upstream.slice(slashIndex + 1),
  }
}

export function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}

function isValidRemotePath(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && path.posix.isAbsolute(value)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R | undefined>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      if (signal?.aborted) return
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = await fn(items[index]!)
      } catch {
        // ignore errors after abort
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (signal?.aborted) return []
  return results.filter((r): r is R => r !== undefined)
}
