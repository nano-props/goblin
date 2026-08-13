import path from 'node:path'
import PQueue from 'p-queue'
import { mapWithConcurrency, runWithQueuedAdmission } from '#/system/git/concurrency.ts'
import {
  parseBootstrapConfig,
  worktreeBootstrapConfigHash,
  type WorktreeBootstrapConfig,
} from '#/system/git/worktree-bootstrap-config.ts'
import { parseLog } from '#/system/git/parsers.ts'
import {
  getRepoUrlForRemotes,
  parseRemoteVerbose,
  repoRemoteInfoForRemotes,
  resolveFetchRemoteForRemotes,
  resolvePushTargetForRemotes,
  type UpstreamParts,
} from '#/system/git/remote.ts'
import { runRemoteCommand, type RemoteCommandKind, type RemoteCommandResult } from '#/system/ssh/commands.ts'
import {
  commandMayHaveRun,
  withoutMutationCommand,
  type CommandExecution,
  type CommandOutcome,
} from '#/system/command-execution.ts'
import {
  decodeRemoteStatus,
  decodeRemoteWorktrees,
  isValidRemotePath,
  parseRemoteCurrentBranch,
  parseRemoteRepoCommonDir,
  parseRemoteSnapshot,
  remoteBootstrapSummaryFromOutput,
  remoteExecResult,
  type RemoteRepoSnapshot,
} from '#/system/ssh/git-codec.ts'
import {
  GIT_HASH_RE,
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
  formatWorktreeBootstrapSummary,
  hasWorktreeBootstrapSummaryDetails,
  worktreeBootstrapPreviewFromConfig,
  type WorktreeBootstrapResult,
  type WorktreeBootstrapPreviewResult,
  type WorktreeBootstrapSummary,
} from '#/shared/worktree-bootstrap-summary.ts'
import { WORKTREE_COMMAND_TIMEOUT_MS } from '#/shared/worktree-operation-timeouts.ts'

export type RemoteGitRunner = (
  command: RemoteCommandKind,
  target: RemoteWorkspaceTarget,
  options?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<RemoteCommandResult>

const REMOTE_WORKTREE_STATUS_CONCURRENCY = 4
// Both aggregate status and patch enumeration use this admission boundary.
const remoteWorktreeStatusQueue = new PQueue({ concurrency: REMOTE_WORKTREE_STATUS_CONCURRENCY })
const REMOTE_FETCH_SPEC_CONCURRENCY = 8
const REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY = 8
const REMOTE_BRANCH_OP_TIMEOUT_MS = 180_000
const REMOTE_PATCH_TIMEOUT_MS = 90_000
const REMOTE_COMMAND_NAME_RE = /^[A-Za-z0-9._+-]+$/

class RemotePatchFileReadError extends Error {
  readonly result: ExecResult

  constructor(result: ExecResult) {
    super(result.message)
    this.result = result
  }
}

export interface RemoteFilesystemMutationResult extends ExecResult {
  worktreePathsToInvalidate?: readonly string[]
}

export interface RemoteWorktreeRemovalResult extends RemoteFilesystemMutationResult {
  worktreeRemoved?: true
  branchEffect?: 'local-delete-confirmed'
  failureExecution?: CommandExecution
  failureStage?: 'worktree-remove' | 'branch-delete'
}

type RemoteBranchEffect = 'none' | 'may-have-changed' | 'local-delete-confirmed'

export interface RemoteBranchDeleteResult extends ExecResult {
  branchEffect: RemoteBranchEffect
  failureExecution?: CommandExecution
}

interface RemoteBranchMutationStepResult extends ExecResult {
  branchEffect?: 'local-delete-confirmed'
  failureExecution?: CommandExecution
  failureStage?: 'branch-delete'
}

function remoteCommandExecution(result: RemoteCommandResult): CommandExecution {
  if (result.commandNotStarted) return { status: 'not-started' }
  if (result.ok) return { status: 'succeeded' }
  if (result.remoteStartUnconfirmed) return { status: 'remote-start-unconfirmed' }
  if (result.timedOut) return { status: 'timed-out' }
  if (result.message === 'cancelled') return { status: 'cancelled' }
  return { status: 'failed' }
}

function remoteCommandOutcome(result: RemoteCommandResult): CommandOutcome {
  return { result: remoteExecResult(result), execution: remoteCommandExecution(result) }
}

export type RemoteWorkspacePaneTargetIdentity =
  { kind: 'git-branch'; branchName: string } | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

/** Authoritative remote repository projection. Transport, cancellation, and malformed output are failures. */
export async function getRemoteSnapshot(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteRepoSnapshot> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const membership = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  const [result, remote] = await Promise.all([
    run({ type: 'gitSnapshot', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteRepoInfo(target, { signal: options.signal, run }),
  ])
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const snapshot = parseRemoteSnapshot(result.stdout, membership)
  if (!snapshot) throw new Error('error.failed-read-repo')
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
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  return await sampleRemoteWorktreeStatus(target, worktrees, { signal: options.signal, run })
}

async function sampleRemoteWorktreeStatus(
  target: RemoteWorkspaceTarget,
  worktrees: readonly WorktreeInfo[],
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeStatus[]> {
  const sampled = await mapWithConcurrency(
    [...worktrees],
    REMOTE_WORKTREE_STATUS_CONCURRENCY,
    async (worktree) => await sampleRemoteWorktreeStatusForTarget(target, worktree, options),
    { signal: options.signal, abort: 'throw' },
  )
  return sampled.filter((status): status is WorktreeStatus => status !== null)
}

async function sampleRemoteWorktreeStatusForTarget(
  target: RemoteWorkspaceTarget,
  worktree: WorktreeInfo,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<WorktreeStatus | null> {
  options.signal?.throwIfAborted()
  if (worktree.isBare) return null
  const result = await runRemoteWorktreeStatusProbe(target, worktree.path, options)
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  return {
    path: worktree.path,
    branch: worktree.branch,
    isMain: worktree.isPrimary,
    entries: decodeRemoteStatus(result.stdout),
  }
}

async function runRemoteWorktreeStatusProbe(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; run: RemoteGitRunner },
): Promise<RemoteCommandResult> {
  return await runAdmittedRemoteStatusCommand(target, { type: 'gitStatus', path: worktreePath }, options)
}

async function runRemoteWorktreeStatusAllProbe(
  target: RemoteWorkspaceTarget,
  worktreePath: string,
  options: { signal?: AbortSignal; timeoutMs: number; run: RemoteGitRunner },
): Promise<RemoteCommandResult> {
  return await runAdmittedRemoteStatusCommand(target, { type: 'gitStatusAll', path: worktreePath }, options)
}

async function runAdmittedRemoteStatusCommand(
  target: RemoteWorkspaceTarget,
  command: Extract<RemoteCommandKind, { type: 'gitStatus' | 'gitStatusAll' }>,
  options: { signal?: AbortSignal; timeoutMs?: number; run: RemoteGitRunner },
): Promise<RemoteCommandResult> {
  options.signal?.throwIfAborted()
  return await runWithQueuedAdmission(
    remoteWorktreeStatusQueue,
    options.signal,
    async () =>
      await options.run(command, target, {
        signal: options.signal,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
  )
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
  return { ok: true, message: 'ok' }
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

  const status = await runRemoteWorktreeStatusAllProbe(target, known.path, {
    run,
    signal: options.signal,
    timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)

  const untrackedPaths = decodeRemoteStatus(status.stdout)
    .filter((entry) => entry.x === '?' && entry.y === '?')
    .map((entry) => entry.path)
  let patchTexts: string[]
  try {
    patchTexts = await mapWithConcurrency(
      untrackedPaths,
      REMOTE_PATCH_UNTRACKED_DIFF_CONCURRENCY,
      async (filePath): Promise<string> => {
        const result = await run({ type: 'gitDiffNoIndex', path: known.path, filePath }, target, {
          signal: options.signal,
          timeoutMs: REMOTE_PATCH_TIMEOUT_MS,
        })
        options.signal?.throwIfAborted()
        if (!result.ok) throw new RemotePatchFileReadError(remoteExecResult(result))
        return result.stdout
      },
      { signal: options.signal, abort: 'throw' },
    )
  } catch (err) {
    if (err instanceof RemotePatchFileReadError) return err.result
    throw err
  }
  const combined = [tracked.stdout, ...patchTexts].filter((part) => part.length > 0).join('\n')
  return { ok: true, message: combined.length > 0 ? `${combined}\n` : '' }
}

export async function fetchRemoteRepo(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<CommandOutcome> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const currentBranch = await getRemoteCurrentBranch(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, { signal: options.signal, run }),
    currentBranch
      ? getRemoteUpstreamParts(target, currentBranch, { signal: options.signal, run })
      : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (remotes.length === 0) return withoutMutationCommand({ ok: true, message: '' })
  const remote = resolveFetchRemoteForRemotes(remotes, upstream)
  if (!remote) return withoutMutationCommand({ ok: true, message: '' })
  const result = await run({ type: 'gitFetchRemote', path: target.remotePath, remote }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
  })
  return remoteCommandOutcome(result)
}

export async function pullRemoteBranch(
  target: RemoteWorkspaceTarget,
  branch: string,
  worktreePath?: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<CommandOutcome<RemoteFilesystemMutationResult>> {
  if (!isSafeBranchName(branch)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  if (worktreePath && !isValidRemotePath(worktreePath)) {
    return withoutMutationCommand({ ok: false, message: 'error.invalid-path' })
  }
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  if (worktreePath) {
    if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
    const result = await run({ type: 'gitPullCurrent', path: worktreePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    return remoteOutcomeWithWorktreeInvalidation(remoteCommandOutcome(result), worktreePath)
  }

  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (snapshot.current === branch) {
    const result = await run({ type: 'gitPullCurrent', path: target.remotePath }, target, {
      signal: options.signal,
      timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS,
    })
    return remoteOutcomeWithWorktreeInvalidation(remoteCommandOutcome(result), target.remotePath)
  }

  const upstream = await getRemoteUpstream(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (!upstream) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  const targetParts = upstream.source
  const remotes = await getRemoteRemotes(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (targetParts.remote !== '.' && !remotes.some((remote) => remote.name === targetParts.remote)) {
    return withoutMutationCommand({ ok: false, message: 'error.pull-no-remote' })
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
  return remoteCommandOutcome(result)
}

export async function pushRemoteBranch(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<CommandOutcome> {
  if (!isSafeBranchName(branch)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const pushTarget = await resolveRemotePushTarget(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if ('ok' in pushTarget) return withoutMutationCommand(pushTarget)
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
  return remoteCommandOutcome(result)
}

export async function createRemoteWorktree(
  target: RemoteWorkspaceTarget,
  input: CreateWorktreeInput & {
    signal?: AbortSignal
    run?: RemoteGitRunner
  },
): Promise<CommandOutcome<RemoteFilesystemMutationResult>> {
  const normalized = normalizeCreateWorktreeInput(input)
  if (!normalized) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  if (!isValidRemotePath(normalized.worktreePath)) {
    return withoutMutationCommand({ ok: false, message: 'error.invalid-path' })
  }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run(
    {
      type: 'gitWorktreeAdd',
      path: target.remotePath,
      input: normalized,
    },
    target,
    { signal: input.signal, timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS },
  )
  const { result: createResult, execution } = remoteCommandOutcome(result)
  const resultWithImpact = createResult.ok
    ? withWorktreePathsToInvalidate(createResult, [normalized.worktreePath])
    : createResult
  return {
    result: resultWithImpact,
    execution,
  }
}

function remoteOutcomeWithWorktreeInvalidation(
  outcome: CommandOutcome,
  worktreePath: string,
): CommandOutcome<RemoteFilesystemMutationResult> {
  const { result, execution } = outcome
  if (!commandMayHaveRun(execution)) return outcome
  return {
    result: {
      ok: result.ok,
      message: result.message,
      worktreePathsToInvalidate: [worktreePath],
    },
    execution,
  }
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
): Promise<WorktreeBootstrapResult> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const loaded = await loadRemoteBootstrapConfig(target, { signal: options.signal, run })
  if (!loaded.ok) return remoteBootstrapFailure(loaded)
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
  const summary = remoteBootstrapSummaryFromOutput(bootstrapResult.stdout)
  if (bootstrapResult.message === 'cancelled') {
    return remoteBootstrapResultWithSummary({ ok: false, message: 'cancelled' }, summary)
  }
  if (!bootstrapResult.ok) {
    return remoteBootstrapResultWithSummary(
      { ok: false, message: `Worktree bootstrap failed: ${bootstrapResult.message}` },
      summary,
    )
  }
  return {
    ok: true,
    message: formatWorktreeBootstrapSummary(summary),
    ...(hasWorktreeBootstrapSummaryDetails(summary) ? { worktreeBootstrap: summary } : {}),
  }
}

function remoteBootstrapResultWithSummary(
  result: ExecResult,
  summary: WorktreeBootstrapSummary,
): WorktreeBootstrapResult {
  if (!hasWorktreeBootstrapSummaryDetails(summary)) return result
  return { ...result, worktreeBootstrap: summary }
}

function remoteBootstrapFailure(result: ExecResult): ExecResult {
  if (result.message === 'cancelled') return result
  return { ok: false, message: `Worktree bootstrap failed: ${result.message}` }
}

export async function getRemoteTrackingBranches(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<RemoteTrackingBranchIdentity[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const authority = await readRemoteTrackingAuthority(target, { signal: options.signal, run })
  options.signal?.throwIfAborted()
  try {
    return parseRemoteTrackingRefs(authority.refs, authority.remotes)
  } catch {
    throw new Error('error.failed-read-repo')
  }
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
    REMOTE_FETCH_SPEC_CONCURRENCY,
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
    { signal: options.signal, abort: 'throw' },
  )
  return { refs: result.stdout, remotes: authorities }
}

export async function getRemoteRepoWorktreePaths(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string[]> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const worktrees = await readRemoteWorktreeMembership(target, { signal: options.signal, run })
  return worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)
}

export async function resolveRemoteRepoCommonDir(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<string | null> {
  const run: RemoteGitRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const result = await run({ type: 'resolveRepoCommonDir', path: target.remotePath }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted || !result.ok) return null
  return parseRemoteRepoCommonDir(result.stdout)
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
  },
): Promise<RemoteWorktreeRemovalResult> {
  if (!isSafeBranchName(input.branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (!isValidRemotePath(input.worktreePath)) return { ok: false, message: 'error.invalid-path' }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const listResult = await run({ type: 'gitWorktreeList', path: target.remotePath }, target, { signal: input.signal })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!listResult.ok) return remoteExecResult(listResult)
  const worktrees = decodeRemoteWorktrees(listResult.stdout)
  const worktreePathsToInvalidate = worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)

  const mainWorktreePath = worktrees.find((worktree) => worktree.isPrimary)?.path ?? worktrees[0]?.path ?? ''
  const resolved = resolveRemoteRemovableWorktree(worktrees, input.branch, input.worktreePath, mainWorktreePath)
  if ('ok' in resolved) return resolved
  const mutationPath = resolved.path === target.remotePath && mainWorktreePath ? mainWorktreePath : target.remotePath

  const status = await runRemoteWorktreeStatusProbe(target, resolved.path, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!status.ok) return remoteExecResult(status)
  const statusAwareWorktree = { ...resolved, isDirty: decodeRemoteStatus(status.stdout).length > 0 }
  const invalid = validateRemovableWorktreeState(statusAwareWorktree)
  if (invalid) return invalid

  const shouldForceDeleteBranch = input.forceDeleteBranch === true
  const upstream =
    input.deleteBranch && (!shouldForceDeleteBranch || input.deleteUpstream)
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
  if (input.signal?.aborted) return { ok: false, message: 'cancelled' }

  const removeResult = await run(
    { type: 'gitWorktreeRemove', path: mutationPath, worktreePath: resolved.path },
    target,
    {
      timeoutMs: WORKTREE_COMMAND_TIMEOUT_MS,
      signal: input.signal,
    },
  )
  const { result: removeCommandResult, execution: removeExecution } = remoteCommandOutcome(removeResult)
  if (!removeCommandResult.ok) {
    const failure: RemoteWorktreeRemovalResult = {
      ok: false,
      message: removeCommandResult.message,
      failureExecution: removeExecution,
      failureStage: 'worktree-remove',
    }
    return commandMayHaveRun(removeExecution)
      ? withWorktreePathsToInvalidate(failure, worktreePathsToInvalidate)
      : failure
  }
  const finalized = await input.afterWorktreeRemoved()
  if (!finalized.ok) {
    return withWorktreePathsToInvalidate(worktreeRemovedResult(finalized), worktreePathsToInvalidate)
  }
  if (!input.deleteBranch) {
    return withWorktreePathsToInvalidate(worktreeRemovedResult(removeCommandResult), worktreePathsToInvalidate)
  }

  const deleteResult = await run(
    { type: 'gitBranchDelete', path: mutationPath, branch: input.branch, force: shouldForceDeleteBranch },
    target,
    { timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS, signal: input.signal },
  )
  const { result: localDeleteResult, execution: localDeleteExecution } = remoteCommandOutcome(deleteResult)
  if (!localDeleteResult.ok) {
    return withWorktreePathsToInvalidate(
      worktreeRemovedResult({
        ...localDeleteResult,
        failureExecution: localDeleteExecution,
        failureStage: 'branch-delete',
      }),
      worktreePathsToInvalidate,
    )
  }
  const upstreamDeleteOutcome = await deleteRemoteUpstreamBranch(
    target,
    mutationPath,
    input.deleteUpstream ? upstream : null,
    {
      signal: input.signal,
      run,
    },
  )
  const finalDeleteResult = finalRemoteBranchDeleteResult(localDeleteResult, upstreamDeleteOutcome)
  return withWorktreePathsToInvalidate(worktreeRemovedResult(finalDeleteResult), worktreePathsToInvalidate)
}

function finalRemoteBranchDeleteResult(
  localDeleteResult: RemoteBranchMutationStepResult,
  upstreamDeleteOutcome: CommandOutcome | null,
): RemoteBranchMutationStepResult {
  if (!upstreamDeleteOutcome) return localDeleteResult
  const { result: upstreamDeleteResult, execution: upstreamDeleteExecution } = upstreamDeleteOutcome
  if (upstreamDeleteResult.ok) return upstreamDeleteResult
  return {
    ...upstreamDeleteResult,
    branchEffect: 'local-delete-confirmed',
    failureExecution: upstreamDeleteExecution,
    failureStage: 'branch-delete',
  }
}

function worktreeRemovedResult(result: RemoteBranchMutationStepResult): RemoteWorktreeRemovalResult {
  if (result.ok) return { ok: true, message: result.message, worktreeRemoved: true }
  const removed: RemoteWorktreeRemovalResult = { ok: false, message: result.message, worktreeRemoved: true }
  if (result.branchEffect === 'local-delete-confirmed') removed.branchEffect = result.branchEffect
  if (result.failureExecution) removed.failureExecution = result.failureExecution
  if (result.failureStage) removed.failureStage = result.failureStage
  return removed
}

function withWorktreePathsToInvalidate(
  result: RemoteWorktreeRemovalResult,
  worktreePathsToInvalidate: readonly string[],
): RemoteWorktreeRemovalResult {
  const unique = Array.from(new Set(worktreePathsToInvalidate.filter((worktreePath) => worktreePath.length > 0)))
  return unique.length > 0 ? { ...result, worktreePathsToInvalidate: unique } : result
}

export async function deleteRemoteBranch(
  target: RemoteWorkspaceTarget,
  input: { branch: string; force?: boolean; deleteUpstream?: boolean; signal?: AbortSignal; run?: RemoteGitRunner },
): Promise<RemoteBranchDeleteResult> {
  if (!isSafeBranchName(input.branch)) {
    return { ok: false, message: 'error.invalid-arguments', branchEffect: 'none' }
  }
  const run: RemoteGitRunner = input.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const snapshot = await getRemoteSnapshot(target, { signal: input.signal, run })
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
  const shouldForce = input.force === true
  const upstream =
    !shouldForce || input.deleteUpstream
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
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
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
  if (validation) return { ok: validation.ok, message: validation.message, branchEffect: 'none' }
  if (input.signal?.aborted) return { ok: false, message: 'cancelled', branchEffect: 'none' }
  const result = await run(
    { type: 'gitBranchDelete', path: target.remotePath, branch: input.branch, force: shouldForce },
    target,
    { signal: input.signal, timeoutMs: REMOTE_BRANCH_OP_TIMEOUT_MS },
  )
  const { result: localDeleteResult, execution: localDeleteExecution } = remoteCommandOutcome(result)
  if (!localDeleteResult.ok) {
    if (!commandMayHaveRun(localDeleteExecution)) {
      return {
        ok: false,
        message: localDeleteResult.message,
        branchEffect: 'none',
        failureExecution: localDeleteExecution,
      }
    }
    return {
      ok: false,
      message: localDeleteResult.message,
      branchEffect: 'may-have-changed',
      failureExecution: localDeleteExecution,
    }
  }
  const upstreamDeleteOutcome = await deleteRemoteUpstreamBranch(
    target,
    target.remotePath,
    input.deleteUpstream ? upstream : null,
    { signal: input.signal, run },
  )
  if (!upstreamDeleteOutcome)
    return { ok: true, message: localDeleteResult.message, branchEffect: 'local-delete-confirmed' }
  const { result: upstreamDeleteResult, execution: upstreamDeleteExecution } = upstreamDeleteOutcome
  if (upstreamDeleteResult.ok) {
    return { ok: true, message: upstreamDeleteResult.message, branchEffect: 'local-delete-confirmed' }
  }
  return {
    ok: false,
    message: upstreamDeleteResult.message,
    branchEffect: 'local-delete-confirmed',
    failureExecution: upstreamDeleteExecution,
  }
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
  const current = parseRemoteCurrentBranch(result.stdout)
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
): Promise<CommandOutcome | null> {
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
  return remoteCommandOutcome(result)
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
  const result = await options.run({ type: 'gitIsAncestor', path: options.path, ancestor, descendant }, target, {
    signal: options.signal,
  })
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
