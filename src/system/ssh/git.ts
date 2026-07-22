import path from 'node:path'
import {
  parseBootstrapConfig,
  validateBootstrapConfigPaths,
  worktreeBootstrapConfigHash,
  type WorktreeBootstrapConfig,
} from '#/system/git/worktree-bootstrap.ts'
import {
  haveSameWorktrees,
  parseBranches,
  parseLog,
  parseStatus,
  parseWorktrees,
} from '#/system/git/parsers.ts'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/system/git/branches.ts'
import {
  getRepoUrlForRemotes,
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
import {
  GIT_HASH_RE,
  type BranchSnapshotInfo,
  type ExecResult,
  type GitRemoteInfo,
  type LogEntry,
  type RepoRemoteInfo,
  type RepoUrlTarget,
  type WorktreeInfo,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import { gitHead, type GitHead } from '#/shared/git-head.ts'
import { decodeGitUpstream, type GitUpstream } from '#/system/git/upstream.ts'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'
import { getRemoteGitDirectoryWalk } from '#/system/ssh/filesystem.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  normalizeCreateWorktreeInput,
  parseRemoteTrackingRefs,
  type CreateWorktreeInput,
  type RemoteFetchAuthority,
  type RemoteTrackingBranchIdentity,
} from '#/shared/worktree-create.ts'
import {
  compactWorktreeBootstrapPaths,
  formatWorktreeBootstrapSummary,
  hasWorktreeBootstrapSummaryDetails,
  worktreeBootstrapPreviewFromConfig,
  type WorktreeBootstrapPreviewResult,
  type WorktreeBootstrapSummary,
} from '#/shared/worktree-bootstrap-summary.ts'

export type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteWorkspaceTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

const REMOTE_WORKTREE_STATUS_CONCURRENCY = 8
const REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY = 8
const REMOTE_BRANCH_OP_TIMEOUT_MS = 180_000
const REMOTE_PATCH_TIMEOUT_MS = 90_000
const REMOTE_COMMAND_NAME_RE = /^[A-Za-z0-9._+-]+$/

export interface RemoteRepoSnapshot {
  branches: BranchSnapshotInfo[]
  current: string
  remote: RepoRemoteInfo
}

export interface RemoteRepoExecutionIdentity {
  commonDir: string
  generationKey: string
}

export interface RemoteWorktreeMutationResult extends ExecResult {
  affectedWorktreePaths?: readonly string[]
}

export type RemoteWorkspacePaneTargetIdentity =
  { kind: 'git-branch'; branchName: string } | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

interface SnapshotSections {
  current: string[]
  defaultBranch: string[]
  branches: string[]
}

/** Authoritative remote repository projection. Transport, cancellation, and malformed output are failures. */
export async function getRemoteSnapshot(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoSnapshot> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const membership = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const [result, statusSnapshot, remote] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    sampleRemoteWorktreeStatus(target, membership, { signal: options.signal, run }),
    getRemoteRepoInfo(target, { signal: options.signal, run }),
  ])
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const snapshot = parseRemoteSnapshot(result.stdout, statusSnapshot.worktrees)
  if (!snapshot) throw new Error('error.failed-read-repo')
  const finalMembership = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  if (!haveSameWorktrees(membership, finalMembership)) throw new Error('error.failed-read-repo')
  return { ...snapshot, remote }
}

/** Narrow identity read for workspace-pane membership. It intentionally skips
 * worktree status and remote display data: neither participates in target
 * identity or terminal admission. */
export async function getRemoteWorkspacePaneTargetIdentities(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteWorkspacePaneTargetIdentity[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const result = await run({ type: 'gitLocalBranches', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const branches = result.stdout ? result.stdout.split('\n') : []
  if (branches.some((branch) => !isSafeBranchName(branch)) || new Set(branches).size !== branches.length) {
    throw new Error('error.failed-read-repo')
  }
  const finalWorktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  if (!haveSameWorktrees(worktrees, finalWorktrees)) throw new Error('error.failed-read-repo')
  const checkedOutBranches = new Set(worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])))
  return [
    ...worktrees.map((worktree): RemoteWorkspacePaneTargetIdentity => ({
      kind: 'git-worktree',
      worktreePath: worktree.path,
      head: gitHead(worktree.branch ?? null),
    })),
    ...branches
      .filter((branch) => !checkedOutBranches.has(branch))
      .map((branch): RemoteWorkspacePaneTargetIdentity => ({ kind: 'git-branch', branchName: branch })),
  ]
}

/** Read status for every authoritative remote worktree. */
export async function getRemoteStatus(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeStatus[]> {
  const { statuses } = await getRemoteStatusAndWorktrees(target, options)
  return statuses
}

/** Read status against an immutable before/after worktree membership snapshot. */
export async function getRemoteStatusAndWorktrees(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<{ statuses: WorktreeStatus[]; worktrees: WorktreeInfo[] }> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const sampled = await sampleRemoteWorktreeStatus(target, worktrees, { signal: options.signal, run })
  const finalWorktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  if (!haveSameWorktrees(worktrees, finalWorktrees)) throw new Error('error.failed-read-repo')
  return sampled
}

async function sampleRemoteWorktreeStatus(
  target: RemoteWorkspaceTarget,
  worktrees: readonly WorktreeInfo[],
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<{ statuses: WorktreeStatus[]; worktrees: WorktreeInfo[] }> {
  const sampled = await mapWithConcurrency(
    [...worktrees],
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree): Promise<WorktreeStatus | null> => {
      if (worktree.isBare) return null
      const result = await options.run({ type: 'gitStatus', path: worktree.path }, target, { signal: options.signal })
      options.signal?.throwIfAborted()
      if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
      return {
        path: worktree.path,
        branch: worktree.branch,
        isMain: worktree.isPrimary,
        entries: decodeRemoteStatus(result.stdout),
      }
    },
    options.signal,
  )
  const statuses = sampled.filter((status): status is WorktreeStatus => status !== null)
  const statusByPath = new Map(statuses.map((status) => [status.path, status]))
  const worktreesWithStatus = worktrees.map((worktree) => {
    const status = statusByPath.get(worktree.path)
    return status
      ? { ...worktree, isDirty: status.entries.length > 0, changeCount: status.entries.length }
      : worktree
  })
  return { statuses, worktrees: worktreesWithStatus }
}

export async function getRemoteLog(
  target: RemoteWorkspaceTarget,
  branch: string,
  count?: number,
  skip?: number,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<LogEntry[]> {
  if (!isSafeBranchName(branch)) return []
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'gitLog', path: target.remotePath, branch, count, skip }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted) return []
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return parseLog(result.stdout)
}

export async function getRemoteTreeWalk(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    prefix?: string
    run?: RemoteGitRunner
    /** Optional trusted worktree list from the caller. When supplied,
     *  the resolver skips its own `gitWorktreeList` round trip and
     *  looks the requested path up in the list. The caller is
     *  responsible for the worktree list being fresh enough to
     *  validate against. */
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return known
  return await getRemoteGitDirectoryWalk(target, known.path, options)
}

export async function trashRemoteFile(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  filePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteGitRunner
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return known
  const result = await run({ type: 'trashFile', path: known.path, filePath }, target, { signal: options.signal })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!result.ok) return remoteExecResult(result)
  return { ok: true, message: 'ok', repositoryStateChanged: true }
}

export async function remoteCommandExists(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  commandName: string,
  options: {
    signal?: AbortSignal
    run?: RemoteGitRunner
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<boolean> {
  if (!REMOTE_COMMAND_NAME_RE.test(commandName)) return false
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  // This helper answers only "can this already-authorized worktree run
  // this command?". It returns false for invalid command names,
  // unresolved worktrees, and failed probes, so callers that need to
  // surface worktree/remote read failures must resolve the worktree
  // first with `resolveRemoteWorktree`.
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return false
  const result = await run({ type: 'commandExists', path: known.path, commandName }, target, { signal: options.signal })
  return !options.signal?.aborted && result.ok
}

/** Probe a command at a path already authorized by the workspace locator boundary. */
export async function remoteCommandExistsAtWorkspaceRoot(
  target: RemoteWorkspaceTarget,
  workspacePath: string,
  commandName: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<boolean> {
  if (!REMOTE_COMMAND_NAME_RE.test(commandName) || !workspacePath.startsWith('/')) return false
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'commandExists', path: workspacePath, commandName }, target, {
    signal: options.signal,
  })
  return !options.signal?.aborted && result.ok
}

/** Resolve a remote worktree path against the remote repo's worktree
 *  list. This membership authority distinguishes remote list failures
 *  from a successful list that lacks the target path, which throws
 *  `error.worktree-not-found`. */
export async function resolveRemoteWorktree(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteGitRunner
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<WorktreeInfo> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) throw new Error(known.message)
  return known
}

export async function getRemotePatch(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run?: RemoteGitRunner
    /** See `getRemoteTreeWalk`. */
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
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

  const untrackedPaths = decodeRemoteStatus(status.stdout)
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

export async function fetchRemoteRepo(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const currentBranch = await getRemoteCurrentBranch(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, { signal: options.signal, run }),
    currentBranch
      ? getRemoteUpstreamParts(target, currentBranch, { signal: options.signal, run })
      : Promise.resolve(null),
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

export async function pullRemoteBranch(
  target: RemoteWorkspaceTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteWorktreeMutationResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (worktreePath && !isValidRemotePath(worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (worktreePath) {
    const result = await run({ type: 'gitPullCurrent', path: worktreePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    const pulled = remoteExecResult(result)
    return pulled.ok || pulled.repositoryStateChanged ? { ...pulled, affectedWorktreePaths: [worktreePath] } : pulled
  }

  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (snapshot.current === branch) {
    const result = await run({ type: 'gitPullCurrent', path: target.remotePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    const pulled = remoteExecResult(result)
    return pulled.ok || pulled.repositoryStateChanged
      ? { ...pulled, affectedWorktreePaths: [target.remotePath] }
      : pulled
  }

  const upstream = await getRemoteUpstream(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!upstream) return { ok: false, message: 'error.invalid-arguments' }
  const targetParts = upstream.source
  const remotes = await getRemoteRemotes(target, { signal: options.signal, run })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (targetParts.remote !== '.' && !remotes.some((remote) => remote.name === targetParts.remote)) {
    return { ok: false, message: 'error.pull-no-remote' }
  }
  const result = await run(
    {
      type: 'gitFetchBranch',
      path: target.remotePath,
      remote: targetParts.remote,
      remoteBranch: targetParts.branch,
      branch,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return remoteExecResult(result)
}

export async function pushRemoteBranch(
  target: RemoteWorkspaceTarget,
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
  target: RemoteWorkspaceTarget,
  input: CreateWorktreeInput & { signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<RemoteWorktreeMutationResult> {
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
  const execResult = remoteExecResult(result)
  return execResult.ok ? withAffectedWorktreePaths(execResult, [normalized.worktreePath]) : execResult
}

const REMOTE_BOOTSTRAP_TIMEOUT_MS = 10 * 60_000

interface RemoteBootstrapConfigLoad {
  config?: WorktreeBootstrapConfig
  configHash?: string
  sourceRoot: string
}

async function loadRemoteBootstrapConfig(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<{ ok: true; value: RemoteBootstrapConfigLoad } | { ok: false; message: string }> {
  const rootResult = await options.run({ type: 'revParseTopLevel', path: target.remotePath }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
  })
  if (rootResult.message === 'cancelled') return { ok: false, message: 'cancelled' }
  if (!rootResult.ok) return { ok: false, message: rootResult.message || 'failed to resolve source repo root' }
  const sourceRoot = rootResult.stdout || target.remotePath

  const readResult = await options.run(
    { type: 'readRemoteFile', path: path.posix.join(sourceRoot, 'goblin.toml') },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (readResult.message === 'cancelled') return { ok: false, message: 'cancelled' }
  if (!readResult.ok) return { ok: false, message: readResult.message || 'failed to read goblin.toml' }

  const raw = readResult.stdout
  if (!raw.trim()) return { ok: true, value: { sourceRoot } }

  const loaded = parseBootstrapConfig(raw)
  if (loaded.kind === 'error') return { ok: false, message: loaded.message }
  if (loaded.kind === 'none') return { ok: true, value: { sourceRoot } }
  const validPaths = validateBootstrapConfigPaths(loaded.config)
  if (!validPaths.ok) return { ok: false, message: validPaths.message }
  return { ok: true, value: { sourceRoot, config: loaded.config, configHash: worktreeBootstrapConfigHash(raw) } }
}

export async function getRemoteWorktreeBootstrapPreview(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeBootstrapPreviewResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return { ok: false, message: `Worktree bootstrap failed: ${loaded.message}` }
  return { ok: true, preview: worktreeBootstrapPreviewFromConfig(loaded.value.config, loaded.value.configHash) }
}

export async function bootstrapRemoteWorktreeAfterCreate(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner; expectedConfigHash?: string } = {},
): Promise<ExecResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return { ok: false, message: `Worktree bootstrap failed: ${loaded.message}` }
  if (!loaded.value.config) {
    if (options.expectedConfigHash) {
      return { ok: false, message: 'Worktree bootstrap failed: goblin.toml changed after confirmation' }
    }
    return { ok: true, message: '' }
  }
  if (options.expectedConfigHash && loaded.value.configHash !== options.expectedConfigHash) {
    return { ok: false, message: 'Worktree bootstrap failed: goblin.toml changed after confirmation' }
  }

  const bootstrapResult = await run(
    {
      type: 'bootstrapRemoteWorktree',
      sourceRoot: loaded.value.sourceRoot,
      targetRoot: worktreePath,
      copy: loaded.value.config.copy,
      symlink: loaded.value.config.symlink,
      hardlink: loaded.value.config.hardlink,
      exclude: loaded.value.config.exclude,
      setup: loaded.value.config.setup,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BOOTSTRAP_TIMEOUT_MS },
  )
  if (bootstrapResult.message === 'cancelled') return { ok: false, message: 'cancelled' }
  if (!bootstrapResult.ok) return { ok: false, message: `Worktree bootstrap failed: ${bootstrapResult.message}` }

  const summary = remoteBootstrapSummaryFromOutput(bootstrapResult.stdout)
  return {
    ok: true,
    message: formatWorktreeBootstrapSummary(summary),
    ...(hasWorktreeBootstrapSummaryDetails(summary) ? { worktreeBootstrap: summary } : {}),
  }
}

function remoteBootstrapSummaryFromOutput(stdout: string): WorktreeBootstrapSummary {
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

export async function getRemoteTrackingBranches(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteTrackingBranchIdentity[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const before = await readRemoteTrackingAuthority(target, { signal: options.signal, run })
  options.signal?.throwIfAborted()
  let branches: RemoteTrackingBranchIdentity[]
  try {
    branches = parseRemoteTrackingRefs(before.refs, before.remotes)
  } catch {
    throw new Error('error.failed-read-repo')
  }
  const after = await readRemoteTrackingAuthority(target, { signal: options.signal, run })
  if (before.refs !== after.refs || JSON.stringify(before.remotes) !== JSON.stringify(after.remotes)) {
    throw new Error('error.failed-read-repo')
  }
  return branches
}

async function readRemoteTrackingAuthority(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<{ refs: string; remotes: RemoteFetchAuthority[] }> {
  const [result, remotes] = await Promise.all([
    options.run({ type: 'gitRemoteBranches', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteRemotes(target, options),
  ])
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const authorities = await mapWithConcurrency(
    remotes,
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (remote): Promise<RemoteFetchAuthority> => {
      const specs = await options.run(
        { type: 'gitRemoteFetchSpecs', path: target.remotePath, remote: remote.name },
        target,
        { signal: options.signal },
      )
      options.signal?.throwIfAborted()
      if (!specs.ok) throw new Error(specs.message || 'error.failed-read-repo')
      return { name: remote.name, fetchSpecs: specs.stdout ? specs.stdout.split('\n') : [] }
    },
    options.signal,
  )
  return { refs: result.stdout, remotes: authorities }
}

async function readRemoteWorktreeList(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return decodeRemoteWorktrees(result.stdout)
}

export async function getRemoteRepoWorktreePaths(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeList(target, { signal: options.signal, run })
  return worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)
}

export async function resolveRemoteRepoExecutionIdentity(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoExecutionIdentity | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'resolveRepoExecutionIdentity', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted || !result.ok) return null
  return parseRemoteRepoExecutionIdentity(result.stdout)
}

export function parseRemoteRepoExecutionIdentity(output: string): RemoteRepoExecutionIdentity | null {
  const fields = output.split('\0')
  const runtimeToken = fields[0] ?? ''
  const machineFact = fields[1] ?? ''
  const rootNamespaceFact = fields[2] ?? ''
  const commonDir = fields[3] ?? ''
  const commonDirDeviceId = fields[4] ?? ''
  const commonDirInode = fields[5] ?? ''
  const objectsDir = fields[6] ?? ''
  const objectsDirDeviceId = fields[7] ?? ''
  const objectsDirInode = fields[8] ?? ''
  if (
    fields.length !== 10 ||
    fields[9] !== '' ||
    !/^[a-f0-9]{32}$/u.test(runtimeToken) ||
    !validRemoteExecutionFact(machineFact) ||
    !validRemoteExecutionFact(rootNamespaceFact) ||
    !commonDir.startsWith('/') ||
    !/^\d{1,32}$/u.test(commonDirDeviceId) ||
    !/^\d{1,32}$/u.test(commonDirInode) ||
    !objectsDir.startsWith('/') ||
    !/^\d{1,32}$/u.test(objectsDirDeviceId) ||
    !/^\d{1,32}$/u.test(objectsDirInode)
  ) {
    return null
  }
  return {
    commonDir: path.posix.normalize(commonDir),
    generationKey: JSON.stringify({
      runtimeToken,
      machineFact,
      rootNamespaceFact,
      commonDirDeviceId,
      commonDirInode,
      objectsDir: path.posix.normalize(objectsDir),
      objectsDirDeviceId,
      objectsDirInode,
    }),
  }
}

function validRemoteExecutionFact(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(value)
}

export async function removeRemoteWorktree(
  target: RemoteWorkspaceTarget,
  input: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
    signal?: AbortSignal
    run?: RemoteGitRunner
    beforeRemove: () => Promise<ExecResult>
    afterWorktreeRemoved: () => Promise<ExecResult>
    afterRemoveFailed: () => Promise<void>
    validateBeforeRemove?: () => Promise<ExecResult>
  },
): Promise<RemoteWorktreeMutationResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (!isValidRemotePath(input.worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)
  const worktrees = decodeRemoteWorktrees(listResult.stdout)
  const affectedWorktreePaths = worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)

  const mainWorktreePath = worktrees.find((worktree) => worktree.isPrimary)?.path ?? worktrees[0]?.path ?? ''
  const resolved = resolveRemoteRemovableWorktree(worktrees, input.branch, input.worktreePath, mainWorktreePath)
  if ('ok' in resolved) return resolved
  const mutationPath = resolved.path === target.remotePath && mainWorktreePath ? mainWorktreePath : target.remotePath

  const status = await run({ type: 'gitStatus', path: resolved.path }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)
  const statusAwareWorktree = { ...resolved, isDirty: decodeRemoteStatus(status.stdout).length > 0 }
  const invalid = validateRemovableWorktreeState(statusAwareWorktree)
  if (invalid) return invalid

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  const upstream = input.deleteBranch && (!shouldForceDeleteBranch || input.deleteUpstream)
    ? await getRemoteUpstream(target, input.branch, {
        signal: input.signal,
        run,
        path: mutationPath,
      })
    : null
  if (input.deleteBranch) {
    const currentBranch = await getRemoteCurrentBranch(target, {
      signal: input.signal,
      run,
      path: mutationPath,
    })
    const mergeFacts = shouldForceDeleteBranch
      ? { mergedToCurrent: false, mergedToUpstream: false }
      : await getRemoteBranchMergeFacts(target, input.branch, {
          signal: input.signal,
          run,
          currentBranch,
          path: mutationPath,
          upstream,
        })
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    const validation = validateBranchDeletionPolicy({
      branch: input.branch,
      currentBranch,
      isCheckedOutElsewhere: worktrees.some((worktree) => worktree.branch === input.branch && worktree !== resolved),
      force: shouldForceDeleteBranch,
      mergedToCurrent: mergeFacts.mergedToCurrent,
      mergedToUpstream: mergeFacts.mergedToUpstream,
      notMergedMessage: 'error.cannot-remove-unpushed-worktree',
    })
    if (validation) return validation
  }

  const prepared = await input.beforeRemove()
  if (!prepared.ok) return prepared
  const exact = await input.validateBeforeRemove?.()
  if (exact && !exact.ok) {
    await input.afterRemoveFailed()
    return exact
  }
  if (input.signal?.aborted) {
    await input.afterRemoveFailed()
    return { ok: false, message: 'cancelled' }
  }

  let removeResult: RemoteCommandResult
  try {
    removeResult = await run({ type: 'gitWorktreeRemove', path: mutationPath, worktreePath: resolved.path }, target, {
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
      signal: input.signal,
    })
  } catch (error) {
    await input.afterRemoveFailed()
    throw error
  }
  if (!removeResult.ok) {
    await input.afterRemoveFailed()
    return remoteExecResult(removeResult)
  }
  const finalized = await input.afterWorktreeRemoved()
  if (!finalized.ok) {
    return withAffectedWorktreePaths({ ...finalized, repositoryStateChanged: true }, affectedWorktreePaths)
  }
  if (!input.deleteBranch) return withAffectedWorktreePaths(remoteExecResult(removeResult), affectedWorktreePaths)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: mutationPath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS, signal: input.signal },
  )
  const localDeleteResult = remoteExecResult(deleteResult)
  if (!localDeleteResult.ok) {
    return withAffectedWorktreePaths({ ...localDeleteResult, repositoryStateChanged: true }, affectedWorktreePaths)
  }
  const upstreamDeleteResult = await deleteRemoteUpstreamBranch(
    target,
    mutationPath,
    input.deleteUpstream ? upstream : null,
    {
    signal: input.signal,
    run,
    },
  )
  return withAffectedWorktreePaths(upstreamDeleteResult ?? localDeleteResult, affectedWorktreePaths)
}

function withAffectedWorktreePaths(
  result: ExecResult,
  affectedWorktreePaths: readonly string[],
): RemoteWorktreeMutationResult {
  const unique = Array.from(new Set(affectedWorktreePaths.filter((worktreePath) => worktreePath.length > 0)))
  return unique.length > 0 ? { ...result, affectedWorktreePaths: unique } : result
}

export async function deleteRemoteBranch(
  target: RemoteWorkspaceTarget,
  input: { branch: string; force?: boolean; deleteUpstream?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const snapshot = await getRemoteSnapshot(target, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const shouldForce = input.force === true
  const upstream = !shouldForce || input.deleteUpstream
    ? await getRemoteUpstream(target, input.branch, { signal: input.signal, run })
    : null
  const mergeFacts = shouldForce
    ? { mergedToCurrent: false, mergedToUpstream: false }
    : await getRemoteBranchMergeFacts(target, input.branch, {
        signal: input.signal,
        run,
        currentBranch: snapshot.current,
        upstream,
      })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const validation = validateBranchDeletionPolicy({
    branch: input.branch,
    currentBranch: snapshot?.current,
    isCheckedOutElsewhere: !!snapshot?.branches.some(
      (branchInfo) => branchInfo.name === input.branch && branchInfo.worktree,
    ),
    force: shouldForce,
    mergedToCurrent: mergeFacts.mergedToCurrent,
    mergedToUpstream: mergeFacts.mergedToUpstream,
  })
  if (validation) return validation
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const result = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForce },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  const localDeleteResult = remoteExecResult(result)
  if (!localDeleteResult.ok) return localDeleteResult
  return (
    (await deleteRemoteUpstreamBranch(target, target.remotePath, input.deleteUpstream ? upstream : null, {
      signal: input.signal,
      run,
    })) ??
    localDeleteResult
  )
}

export async function getRemoteBrowserUrl(
  target: RemoteWorkspaceTarget,
  urlTarget: RepoUrlTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string | null> {
  if (urlTarget.type === 'branch' && !isSafeBranchName(urlTarget.branch)) return null
  if (urlTarget.type === 'commit' && !GIT_HASH_RE.test(urlTarget.hash)) return null
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const branch = urlTarget.type === 'branch' ? urlTarget.branch : undefined
  const [remoteInfo, upstream] = await Promise.all([
    getRemoteRepoInfo(target, { signal: options.signal, run }),
    branch ? getRemoteUpstreamParts(target, branch, { signal: options.signal, run }) : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return null
  return getRepoUrlForRemotes(remoteInfo.remotes, urlTarget, upstream)
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

function singleOptionalBranchName(lines: readonly string[]): string | null {
  if (lines.length !== 1 || !lines[0]!.startsWith('value ')) return null
  const value = lines[0]!.slice('value '.length)
  return value === '' || isSafeBranchName(value) ? value : null
}

async function readRemoteWorktreeMembership(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeInfo[]> {
  const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return decodeRemoteWorktrees(result.stdout)
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

async function resolveKnownRemoteWorktree(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    run: RemoteGitRunner
    /** Pre-fetched worktree list; when supplied we skip the
     *  `gitWorktreeList` round trip. */
    knownWorktrees?: ReadonlyArray<WorktreeInfo>
  },
): Promise<WorktreeInfo | ExecResult> {
  let worktrees: ReadonlyArray<WorktreeInfo>
  if (options.knownWorktrees) {
    worktrees = options.knownWorktrees
  } else {
    const result = await options.run({ type: 'gitWorktreeList', path: target.remotePath }, target, {
      signal: options.signal,
    })
    if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
    if (!result.ok) return remoteExecResult(result)
    worktrees = decodeRemoteWorktrees(result.stdout)
  }
  const resolvedPath = path.posix.resolve(worktreePath)
  const worktree = worktrees.find((item) => path.posix.resolve(item.path) === resolvedPath && !item.isBare)
  if (!worktree) return { ok: false, message: 'error.worktree-not-found' }
  return worktree
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  mainWorktreePath: string,
): WorktreeInfo | ExecResult {
  const resolvedPath = path.posix.resolve(worktreePath)
  const target = worktrees.find(
    (worktree) => path.posix.resolve(worktree.path) === resolvedPath && worktree.branch === branch,
  )
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (
    target.isPrimary ||
    (!!mainWorktreePath && path.posix.resolve(target.path) === path.posix.resolve(mainWorktreePath))
  ) {
    return { ok: false, message: 'error.cannot-remove-main-worktree' }
  }
  return target
}

async function getRemoteUpstream(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner; path?: string },
): Promise<GitUpstream | null> {
  const result = await options.run({ type: 'gitUpstream', path: options.path ?? target.remotePath, branch }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  try {
    return decodeGitUpstream(result.stdout)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

async function getRemoteRemotes(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<GitRemoteInfo[]> {
  const result = await options.run({ type: 'gitRemoteVerbose', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  try {
    return parseRemoteVerbose(result.stdout)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

async function getRemoteCurrentBranch(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner; path?: string },
): Promise<string> {
  const result = await options.run({ type: 'gitSnapshot', path: options.path ?? target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const sections = splitSnapshotSections(result.stdout)
  if (!sections) throw new Error('error.failed-read-repo')
  const current = singleOptionalBranchName(sections.current)
  if (current === null) throw new Error('error.failed-read-repo')
  return current
}

async function getRemoteUpstreamParts(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner; path?: string },
): Promise<UpstreamParts | null> {
  const upstream = await getRemoteUpstream(target, branch, options)
  return upstream?.source ?? null
}

async function deleteRemoteUpstreamBranch(
  target: RemoteWorkspaceTarget,
  gitPath: string,
  upstream: GitUpstream | null,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<ExecResult | null> {
  if (!upstream?.deleteTarget) return null
  const result = await options.run(
    {
      type: 'gitPushDeleteBranch',
      path: gitPath,
      remote: upstream.deleteTarget.remote,
      branch: upstream.deleteTarget.branch,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (options.signal?.aborted) return { ok: false, message: 'cancelled', repositoryStateChanged: true }
  const execResult = remoteExecResult(result)
  return execResult.ok ? execResult : { ...execResult, repositoryStateChanged: true }
}

async function getRemoteRepoInfo(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<RepoRemoteInfo> {
  return repoRemoteInfoForRemotes(await getRemoteRemotes(target, options))
}

async function getRemoteBranchMergeFacts(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: {
    signal?: AbortSignal
    run: RemoteGitRunner
    currentBranch?: string
    path?: string
    upstream: GitUpstream | null
  },
): Promise<{ mergedToCurrent: boolean; mergedToUpstream: boolean }> {
  const gitPath = options.path ?? target.remotePath
  let mergedToCurrent = false
  if (options.currentBranch) {
    mergedToCurrent = await getRemoteIsAncestor(target, branch, options.currentBranch, {
      signal: options.signal,
      run: options.run,
      path: gitPath,
    })
  }
  let mergedToUpstream = false
  if (options.upstream?.ancestryRef) {
    mergedToUpstream = await getRemoteIsAncestor(target, branch, options.upstream.ancestryRef, {
      signal: options.signal,
      run: options.run,
      path: gitPath,
    })
  }
  return { mergedToCurrent, mergedToUpstream }
}

async function getRemoteIsAncestor(
  target: RemoteWorkspaceTarget,
  ancestor: string,
  descendant: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner; path: string },
): Promise<boolean> {
  const result = await options.run(
    { type: 'gitIsAncestor', path: options.path, ancestor, descendant },
    target,
    { signal: options.signal },
  )
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const value = result.stdout.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('error.failed-read-repo')
}

async function resolveRemotePushTarget(
  target: RemoteWorkspaceTarget,
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

export function remoteExecResult(result: RemoteCommandResult): ExecResult {
  if (result.ok) return { ok: true, message: result.stdout || result.stderr || 'ok' }
  return { ok: false, message: result.message || result.stderr || 'error.unknown' }
}

function isValidRemotePath(value: string): boolean {
  return value.length > 0 && !value.includes('\0') && path.posix.isAbsolute(value)
}

function decodeRemoteWorktrees(output: string): WorktreeInfo[] {
  try {
    const worktrees = parseWorktrees(output)
    if (worktrees.some((worktree) => !isValidRemotePath(worktree.path))) throw new Error('Invalid remote worktree path')
    return worktrees
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

function decodeRemoteStatus(output: string) {
  try {
    return parseStatus(output)
  } catch {
    throw new Error('error.failed-read-repo')
  }
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
      } catch (err) {
        if (signal?.aborted) return
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (signal?.aborted) return []
  return results.filter((r): r is R => r !== undefined)
}
