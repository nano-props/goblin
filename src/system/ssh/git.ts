import path from 'node:path'
import {
  parseBootstrapConfig,
  validateBootstrapConfigPaths,
  worktreeBootstrapConfigHash,
  type WorktreeBootstrapConfig,
} from '#/system/git/worktree-bootstrap.ts'
import {
  parseBranches,
  parseLog,
  parseStatus,
  parseWorktreeStatusBatch,
  parseWorktrees,
  splitWorktreeStatusBatch,
} from '#/system/git/parsers.ts'
import { markDefaultBranch, prioritizeDefaultBranch } from '#/system/git/branches.ts'
import {
  getBranchUrlForRemotes,
  getBrowserRemoteUrlForRemotes,
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
  type BranchSnapshotInfo,
  type ExecResult,
  type GitRemoteInfo,
  type LogEntry,
  type RepoRemoteInfo,
  type WorktreeInfo,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  normalizeCreateWorktreeInput,
  parseRemoteTrackingRefs,
  type CreateWorktreeInput,
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
  target: RemoteRepoTarget,
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

export interface RemoteWorktreeMutationResult extends ExecResult {
  affectedWorktreePaths?: readonly string[]
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
  // Thin wrapper over the batched path. The single SSH call behind
  // `getRemoteStatusAndWorktrees` returns both the worktree list and
  // the per-worktree status, so callers that only need the statuses
  // pay the same wire cost as callers that need both.
  const { statuses } = await getRemoteStatusAndWorktrees(target, options)
  return statuses
}

/**
 * Fetch the remote repo's worktree list and per-worktree porcelain
 * status in a single SSH round trip. The remote side runs
 * `git worktree list --porcelain` and then, for every non-bare
 * worktree, `git status --porcelain -z -uall`, batching the result
 * with a marker-separated NUL stream (see the `gitWorktreeListAndStatus`
 * command).
 *
 * Returning both shapes lets the caller thread the worktree list into
 * `getRemoteTreeWalk` / `getRemotePatch` so neither pays a second
 * `gitWorktreeList` round trip. That collapses the remote `/tree`
 * read path from (1 worktree-list + N statuses + 1 redundant
 * worktree-list + 1 walk) to (1 batched call + 1 walk) = 2 calls.
 */
export async function getRemoteStatusAndWorktrees(
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<{ statuses: WorktreeStatus[]; worktrees: WorktreeInfo[] }> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    { type: 'gitWorktreeListAndStatus', path: target.remotePath },
    target,
    { signal: options.signal },
  )
  if (options.signal?.aborted) return { statuses: [], worktrees: [] }
  if (!result.ok) return { statuses: [], worktrees: [] }

  const { worktreeListOutput, statusStream } = splitWorktreeStatusBatch(result.stdout)
  const worktrees = parseWorktrees(worktreeListOutput)
  if (options.signal?.aborted) return { statuses: [], worktrees }
  const statusByPath = parseWorktreeStatusBatch(statusStream)

  const statuses: WorktreeStatus[] = []
  for (const worktree of worktrees) {
    if (worktree.isBare) continue
    const entries = statusByPath.get(worktree.path)
    // A worktree that the remote script could not enter (cd failed
    // or rev-parse failed) is absent from the status stream. Treat
    // it as clean rather than dropping the worktree silently -- the
    // Status tab will still show the worktree, just without changes.
    const safeEntries = entries ? [...entries] : []
    statuses.push({
      path: worktree.path,
      branch: worktree.branch,
      isMain: worktree.isPrimary,
      entries: safeEntries,
    })
  }
  return { statuses, worktrees }
}

export async function getRemoteLog(
  target: RemoteRepoTarget,
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
  target: RemoteRepoTarget,
  worktreePath: string,
  options: {
    signal?: AbortSignal
    depth?: number
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
  const depth = Math.max(1, Math.min(10, Math.floor(options.depth ?? 10)))
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return known
  const result = await run({ type: 'gitTreeWalk', path: known.path, depth }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!result.ok) return remoteExecResult(result)
  return { ok: true, message: result.stdout }
}

export async function trashRemoteFile(
  target: RemoteRepoTarget,
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
  return { ok: true, message: 'ok', repoChanged: true }
}

export async function remoteCommandExists(
  target: RemoteRepoTarget,
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
  const known = await resolveKnownRemoteWorktree(target, worktreePath, {
    signal: options.signal,
    run,
    knownWorktrees: options.knownWorktrees,
  })
  if ('ok' in known) return false
  const result = await run({ type: 'commandExists', path: known.path, commandName }, target, { signal: options.signal })
  return !options.signal?.aborted && result.ok
}

export async function getRemotePatch(
  target: RemoteRepoTarget,
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

export async function fetchRemoteRepo(
  target: RemoteRepoTarget,
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
  target: RemoteRepoTarget,
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
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<WorktreeBootstrapPreviewResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return { ok: false, message: `Worktree bootstrap failed: ${loaded.message}` }
  return { ok: true, preview: worktreeBootstrapPreviewFromConfig(loaded.value.config, loaded.value.configHash) }
}

export async function bootstrapRemoteWorktreeAfterCreate(
  target: RemoteRepoTarget,
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
): Promise<RemoteWorktreeMutationResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)
  const worktrees = parseWorktrees(listResult.stdout)
  const affectedWorktreePaths = worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)

  const mainWorktreePath = worktrees.find((worktree) => worktree.isPrimary)?.path ?? worktrees[0]?.path ?? ''
  const resolved = resolveRemoteRemovableWorktree(worktrees, input.branch, input.worktreePath, mainWorktreePath)
  if ('ok' in resolved) return resolved
  const mutationPath = resolved.path === target.remotePath && mainWorktreePath ? mainWorktreePath : target.remotePath

  const status = await run({ type: 'gitStatus', path: resolved.path }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  const statusAwareWorktree = !status.ok
    ? { ...resolved, isDirty: undefined }
    : { ...resolved, isDirty: parseStatus(status.stdout).length > 0 }
  const invalid = validateRemovableWorktreeState(statusAwareWorktree)
  if (invalid) return invalid

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  if (input.alsoDeleteBranch) {
    const currentBranch = await getRemoteCurrentBranch(target, { signal: input.signal, run, path: mutationPath })
    const mergeFacts = shouldForceDeleteBranch
      ? { mergedToCurrent: false, mergedToUpstream: false }
      : await getRemoteBranchMergeFacts(target, input.branch, {
          signal: input.signal,
          run,
          currentBranch,
          path: mutationPath,
        })
    if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
    const validation = validateBranchDeletionPolicy({
      branch: input.branch,
      currentBranch,
      isCheckedOutElsewhere: worktrees.some(
        (worktree) => worktree.branch === input.branch && worktree.path !== resolved.path,
      ),
      force: shouldForceDeleteBranch,
      mergedToCurrent: mergeFacts.mergedToCurrent,
      mergedToUpstream: mergeFacts.mergedToUpstream,
      notMergedMessage: 'error.cannot-remove-unpushed-worktree',
    })
    if (validation) return validation
  }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: mutationPath, worktreePath: resolved.path },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!removeResult.ok) return remoteExecResult(removeResult)
  if (!input.alsoDeleteBranch) return withAffectedWorktreePaths(remoteExecResult(removeResult), affectedWorktreePaths)

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: mutationPath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  return withAffectedWorktreePaths(remoteExecResult(deleteResult), affectedWorktreePaths)
}

function withAffectedWorktreePaths(
  result: ExecResult,
  affectedWorktreePaths: readonly string[],
): RemoteWorktreeMutationResult {
  const unique = Array.from(new Set(affectedWorktreePaths.filter((worktreePath) => worktreePath.length > 0)))
  return unique.length > 0 ? { ...result, affectedWorktreePaths: unique } : result
}

export async function deleteRemoteBranch(
  target: RemoteRepoTarget,
  input: { branch: string; force?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<ExecResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
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
    isCheckedOutElsewhere: !!snapshot?.branches.some(
      (branchInfo) => branchInfo.name === input.branch && branchInfo.worktree,
    ),
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
  if (branch && !isSafeBranchName(branch)) return null
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const [remoteInfo, upstream] = await Promise.all([
    getRemoteRepoInfo(target, { signal: options.signal, run }),
    branch ? getRemoteUpstreamParts(target, branch, { signal: options.signal, run }) : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return null
  return branch
    ? getBranchUrlForRemotes(remoteInfo.remotes, branch, upstream)
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
    worktrees = parseWorktrees(result.stdout)
  }
  const worktree = worktrees.find((item) => item.path === worktreePath && !item.isBare)
  if (!worktree) return { ok: false, message: 'error.worktree-not-found' }
  return worktree
}

function resolveRemoteRemovableWorktree(
  worktrees: WorktreeInfo[],
  branch: string,
  worktreePath: string,
  mainWorktreePath: string,
): WorktreeInfo | ExecResult {
  const target = worktrees.find((worktree) => worktree.path === worktreePath && worktree.branch === branch)
  if (!target) return { ok: false, message: 'error.worktree-not-found-for-branch' }
  if (target.isPrimary || (!!mainWorktreePath && target.path === mainWorktreePath)) {
    return { ok: false, message: 'error.cannot-remove-main-worktree' }
  }
  return target
}

async function getRemoteUpstream(
  target: RemoteRepoTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner; path?: string },
): Promise<string | null> {
  const result = await options.run({ type: 'gitUpstream', path: options.path ?? target.remotePath, branch }, target, {
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
  options: { signal?: AbortSignal; run: RemoteGitRunner; path?: string },
): Promise<string> {
  const result = await options.run({ type: 'gitSnapshot', path: options.path ?? target.remotePath }, target, {
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
  options: { signal?: AbortSignal; run: RemoteGitRunner; currentBranch?: string; path?: string },
): Promise<{ mergedToCurrent: boolean; mergedToUpstream: boolean }> {
  const gitPath = options.path ?? target.remotePath
  let mergedToCurrent = false
  if (options.currentBranch) {
    const result = await options.run(
      { type: 'gitIsAncestor', path: gitPath, ancestor: branch, descendant: options.currentBranch },
      target,
      { signal: options.signal },
    )
    mergedToCurrent = result.ok && !options.signal?.aborted
  }
  let mergedToUpstream = false
  const upstream = await getRemoteUpstream(target, branch, options)
  if (upstream && !options.signal?.aborted) {
    const result = await options.run(
      { type: 'gitIsAncestor', path: gitPath, ancestor: branch, descendant: upstream },
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
