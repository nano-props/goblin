import path from 'node:path'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { commandMayHaveRun } from '#/system/command-execution.ts'
import type { CommandExecution } from '#/system/command-execution.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { RepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import {
  createRemoteMutationAttempt,
  remoteRuntimeAwareGitRunner,
  resolveRemoteWorkspaceTarget,
  type RepoSourceRuntimeContext,
} from '#/server/modules/remote-repo-execution.ts'
import {
  repoWriteBoundaryKey,
  resolveLocalRepoExecution,
  resolveLocalRepoWriteBoundaryForPath,
  resolveRemoteRepoWriteBoundaryForTarget,
  resolveRepoWriteBoundaryForLocator,
} from '#/server/modules/repo-write-boundary.ts'
import {
  appendRepoMutationRecoveryMessageKey,
  localWorktreeRepoIds,
  remoteWorktreeRepoIds,
  uniqueRepoMutationRecoveryMessageKeys,
  withRepoIdsToInvalidate,
  workspaceIdForLocalWorktreePath,
  type CreateWorktreeMutationResult,
  type RepoMutationResult,
} from '#/server/modules/repo-mutation-impact.ts'
import { RepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import {
  deleteBranch,
  deleteUpstreamBranch,
  getBranchWorktreeIdentities,
  getBranches,
  getCurrentBranch,
  getLog as getGitLog,
  getRepoRoot,
  resolveGitWorkspacePath,
  getUpstream,
  isAncestor,
  isGitRepo,
} from '#/system/git/branches.ts'
import { readRepoWorktreeSnapshots } from '#/system/git/worktree-state.ts'
import {
  fetchAll,
  getBrowserRepoUrl,
  getRemoteInfo,
  pickPreferredRemote,
  pullBranch,
  pushBranch,
} from '#/system/git/remote.ts'
import { getRemoteTrackingBranches as getLocalRemoteTrackingBranches } from '#/system/git/remote-refs.ts'
import { getWorkingStatus, sampleWorktreeStatusForTarget } from '#/system/git/status.ts'
import { createWorktree, readWorktreeMembership, removeWorktree } from '#/system/git/worktrees.ts'
import {
  bootstrapWorktreeAfterCreate,
  getWorktreeBootstrapPreview as getLocalWorktreeBootstrapPreview,
} from '#/system/git/worktree-bootstrap.ts'
import { getWorktreePatch } from '#/system/git/patch.ts'
import {
  type ExecResult,
  type ExecResultRecoveryMessageKey,
  type LogEntry,
  type PullRequestFetchMode,
  type PullRequestInfo,
  repoWorktreeForBranch,
  repoWorktreeMaterializedBranch,
  type RepoMutationExecResult,
  type RepoLogTarget,
  type RepoWorktreeSnapshot,
  type RepoUrlTarget,
  type WorktreeInfo,
  type WorktreeStatus,
  type WorkspacePaneTargetIdentity,
} from '#/shared/git-types.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'
import { isValidCwd } from '#/shared/input-validation.ts'
import { validateBranchDeletionPolicy, validateRemovableWorktreeState } from '#/shared/repo-action-policy.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepo,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemotePatch,
  getRemoteRepoWorktreePaths,
  resolveRemoteWorktreePath,
  getRemoteWorkspacePaneTargetIdentities,
  getRemoteSnapshot,
  getRemoteStatus,
  getRemoteWorktreeBootstrapPreview,
  getRemoteTrackingBranches as getSshRemoteTrackingBranches,
  type RemoteGitRunner,
  type RemoteWorktreeRemovalResult,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { getBranchPullRequests, getBranchPullRequestsForRepoRef } from '#/system/git/pull-requests.ts'
import type { GitUpstream } from '#/system/git/upstream.ts'
import type { RemoteTrackingBranchIdentity } from '#/shared/worktree-create.ts'
import { parseGitHubRemoteUrl, type GitHubRepoRef } from '#/system/github/graphql.ts'
import type { PullRequestEntry, RepoPullRequestScope, RepoSnapshot } from '#/shared/api-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import { isRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { parseWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  physicalWorktreeExecutionBinding,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

interface BranchDeleteResult extends ExecResult {
  branchEffect: 'none' | 'may-have-changed' | 'local-delete-confirmed'
  failureExecution?: CommandExecution
}

interface RepoMembershipReadOptions {
  signal?: AbortSignal
}

type RunRepoMembershipMutation = <T>(mutation: () => Promise<T>) => Promise<T>

export interface RepoSource {
  id: string
  kind: 'local' | 'remote'
  getSnapshot(options?: RepoMembershipReadOptions): Promise<RepoSnapshot | null>
  getWorkspacePaneTargetIdentities(options?: RepoMembershipReadOptions): Promise<WorkspacePaneTargetIdentity[]>
  getStatus(options?: RepoMembershipReadOptions): Promise<WorktreeStatus[]>
  getPullRequests(scope: RepoPullRequestScope, options?: { signal?: AbortSignal }): Promise<PullRequestEntry[] | null>
  getLog(target: RepoLogTarget, options?: { count?: number; skip?: number; signal?: AbortSignal }): Promise<LogEntry[]>
  getRemoteBranches(signal?: AbortSignal): Promise<RemoteTrackingBranchIdentity[]>
  fetch(signal: AbortSignal): Promise<RepoMutationResult>
  pull(branch: string, worktreePath?: string, signal?: AbortSignal): Promise<RepoMutationResult>
  push(branch: string, signal?: AbortSignal): Promise<RepoMutationResult>
  getWorktreeBootstrapPreview(signal?: AbortSignal): Promise<WorktreeBootstrapPreviewResult>
  createWorktree(
    input: CreateWorktreeInput,
    signal: AbortSignal | undefined,
    options: {
      runMembershipMutation: RunRepoMembershipMutation
      worktreeBootstrap?: WorktreeBootstrapDecision
    },
  ): Promise<CreateWorktreeMutationResult>
  deleteBranch(
    branch: string,
    options?: { force?: boolean; deleteUpstream?: boolean },
    signal?: AbortSignal,
  ): Promise<RepoMutationResult>
  removeWorktree(
    input: {
      branch: string
      worktreePath: string
      deleteBranch: boolean
      forceDeleteBranch?: boolean
      deleteUpstream?: boolean
    },
    signal: AbortSignal | undefined,
    lifecycle: RepoWorktreeRemovalLifecycle,
    runMembershipMutation: RunRepoMembershipMutation,
  ): Promise<RepoMutationResult>
  getPatch(worktreePath: string, signal?: AbortSignal): Promise<ExecResult>
  getBrowserRepoUrl(target: RepoUrlTarget, signal?: AbortSignal): Promise<string | null>
}

declare const repoWriteExecutionCapabilityBrand: unique symbol

export interface RepoWriteExecutionCapability {
  readonly [repoWriteExecutionCapabilityBrand]: true
}

interface RepoWriteExecutionState {
  boundaryKey: string
  source: RepoSource
}

interface RepoWriteExecutionSnapshot {
  boundaryKey: string
  source: RepoSource
}

const repoWriteExecutions = new WeakMap<RepoWriteExecutionCapability, RepoWriteExecutionState>()

function serverWorkspaceLocatorPlatform() {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

export async function runWithRepoSource<T>(
  cwd: WorkspaceId,
  task: (source: Awaited<ReturnType<typeof resolveRepoSource>>) => Promise<T>,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<T> {
  return await task(await resolveRepoSource(cwd, runtime, signal))
}

export async function resolveRepoSource(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoSource> {
  signal?.throwIfAborted()
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator) throw new Error('error.workspace-locator-malformed')
  return locator.transport === 'ssh'
    ? await createRemoteRepoSource(repoId, undefined, null, runtime, signal)
    : createLocalRepoSource(locator.path)
}

async function resolveRepoWriteExecutionState(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteExecutionSnapshot> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator) throw new Error('error.workspace-locator-malformed')
  if (locator.transport === 'file') {
    const execution = await resolveLocalRepoExecution(locator.path, signal)
    return {
      boundaryKey: repoWriteBoundaryKey(execution.boundary),
      source: createLocalRepoSource(execution.canonicalRepoPath),
    }
  }

  const target = await resolveRemoteWorkspaceTarget(repoId, runtime, signal)
  const run = runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined
  const boundary = await resolveRemoteRepoWriteBoundaryForTarget(target, signal, run)
  return {
    boundaryKey: repoWriteBoundaryKey(boundary),
    source: await createRemoteRepoSource(repoId, target, null, runtime),
  }
}

export async function captureRepoWriteExecution(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteExecutionCapability> {
  const captured = await resolveRepoWriteExecutionState(repoId, runtime, signal)
  const capability = Object.freeze({}) as RepoWriteExecutionCapability
  repoWriteExecutions.set(capability, captured)
  return capability
}

export async function captureRepoWriteExecutionFromPhysicalWorktree(
  repoId: WorkspaceId,
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteExecutionCapability> {
  const execution = physicalWorktreeExecutionBinding(physicalWorktreeCapability)
  const capturedLocatorBoundary = await resolveRepoWriteBoundaryForLocator(repoId, runtime, signal)
  const boundary =
    execution.kind === 'remote'
      ? await resolveRemoteRepoWriteBoundaryForTarget(
          execution.target,
          signal,
          runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, execution.target) : undefined,
        )
      : await resolveLocalRepoWriteBoundaryForPath(execution.canonicalWorktreePath, signal)
  const capturedLocatorBoundaryKey = repoWriteBoundaryKey(capturedLocatorBoundary)
  const capturedPhysicalBoundaryKey = repoWriteBoundaryKey(boundary)
  if (capturedLocatorBoundaryKey !== capturedPhysicalBoundaryKey) throw new RepositoryBoundaryUnavailableError()
  const source =
    execution.kind === 'remote'
      ? await createRemoteRepoSource(repoId, execution.target, physicalWorktreeCapability, runtime)
      : createLocalRepoSource(execution.canonicalWorktreePath, physicalWorktreeCapability)
  const state: RepoWriteExecutionState = {
    boundaryKey: capturedPhysicalBoundaryKey,
    source,
  }
  const capability = Object.freeze({}) as RepoWriteExecutionCapability
  repoWriteExecutions.set(capability, state)
  return capability
}

export function repoWriteExecutionBoundaryKey(capability: RepoWriteExecutionCapability): string {
  return repoWriteExecutionState(capability).boundaryKey
}

export async function runWithCapturedRepoWriteExecution<T>(
  capability: RepoWriteExecutionCapability,
  task: (source: RepoSource) => Promise<T>,
): Promise<T> {
  return await task(repoWriteExecutionState(capability).source)
}

function repoWriteExecutionState(capability: RepoWriteExecutionCapability): RepoWriteExecutionState {
  const state = repoWriteExecutions.get(capability)
  if (!state) throw new Error('error.invalid-repository-write-capability')
  return state
}

async function readLocalRepoIdsToInvalidate(repoId: string, signal?: AbortSignal): Promise<WorkspaceId[]> {
  const worktrees = await readWorktreeMembership(repoId, signal)
  signal?.throwIfAborted()
  return localRepoIdsToInvalidate(repoId, worktrees)
}

function localRepoIdsToInvalidate(repoId: string, worktrees: readonly WorktreeInfo[]): WorkspaceId[] {
  const repoIdsToInvalidate = localWorktreeRepoIds(worktrees)
  const sourceRepoId = workspaceIdForLocalWorktreePath(repoId)
  if (sourceRepoId) repoIdsToInvalidate.unshift(sourceRepoId)
  return Array.from(new Set(repoIdsToInvalidate))
}

async function readRemoteRepoIdsToInvalidate(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
  run?: RemoteGitRunner,
): Promise<WorkspaceId[]> {
  const worktreePaths = await getRemoteRepoWorktreePaths(target, { signal, run })
  signal?.throwIfAborted()
  return Array.from(new Set([target.id, ...remoteWorktreeRepoIds(target, worktreePaths)]))
}

async function runRemoteRepoMutation<Result extends RepoMutationResult>(
  repoId: string,
  target: RemoteWorkspaceTarget,
  runtime: RepoSourceRuntimeContext | undefined,
  fallbackRun: RemoteGitRunner | undefined,
  task: (run: RemoteGitRunner) => Promise<Result>,
): Promise<Result> {
  const run = fallbackRun ?? ((command, remoteTarget, options) => runRemoteCommand(remoteTarget, command, options))
  if (!runtime) return await task(run)
  const attempt = createRemoteMutationAttempt(repoId, runtime.workspaceRuntimeId, target)
  try {
    const mutation = await task(attempt.run)
    const runtimeFailure = attempt.capturedRuntimeFailure()
    if (runtimeFailure) throw new RepoMutationRuntimeFailureError(mutation, runtimeFailure)
    return mutation
  } catch (error) {
    if (error instanceof RepoMutationRuntimeFailureError) throw error
    throw attempt.capturedRuntimeFailure() ?? error
  }
}

function remoteMembershipMutationRunner(
  run: RemoteGitRunner,
  runMembershipMutation: RunRepoMembershipMutation,
): RemoteGitRunner {
  return async (command, target, options) => {
    if (command.type !== 'gitWorktreeAdd' && command.type !== 'gitWorktreeRemove') {
      return await run(command, target, options)
    }
    return await runMembershipMutation(async () => await run(command, target, options))
  }
}

function commandFailureForUser<T extends ExecResult>(result: T, execution: CommandExecution): T {
  if (result.ok) return result
  if (execution.status === 'cancelled') return { ...result, message: 'error.git-command-cancelled-check-state' }
  if (execution.status === 'timed-out') return { ...result, message: 'error.git-command-timeout-check-state' }
  if (execution.status === 'remote-start-unconfirmed') {
    return { ...result, message: 'error.ssh-remote-command-start-unconfirmed' }
  }
  return result
}

function withCommandImpact<T extends ExecResult>(
  result: T,
  execution: CommandExecution,
  repoIdsToInvalidate: readonly WorkspaceId[],
): T & RepoMutationResult {
  if (!commandMayHaveRun(execution)) return result
  return withRepoIdsToInvalidate(result, repoIdsToInvalidate)
}

function worktreeCommandFailureForUser<T extends ExecResult>(
  result: T,
  execution: CommandExecution,
  operation: 'create' | 'remove',
): T {
  if (result.ok || !commandMayHaveRun(execution)) return result
  if (execution.status === 'timed-out') {
    return { ...result, message: worktreeCommandTimeoutMessage(operation) }
  }
  return commandFailureForUser(result, execution)
}

function worktreeCommandTimeoutMessage(operation: 'create' | 'remove'): string {
  switch (operation) {
    case 'create':
      return 'error.worktree-create-timeout-check-state'
    case 'remove':
      return 'error.worktree-remove-timeout-check-state'
  }
  const exhaustive: never = operation
  return exhaustive
}

function withRecoveryMessage<Result extends RepoMutationExecResult>(
  result: Result,
  recoveryMessage: ExecResultRecoveryMessageKey,
): Result {
  if (result.ok) return result
  const recoveryMessageKeys = appendRepoMutationRecoveryMessageKey(result.recoveryMessageKeys, recoveryMessage)
  return { ...result, recoveryMessageKeys }
}

function worktreeCreatedFollowupFailureForUser(result: RepoMutationExecResult): CreateWorktreeMutationResult {
  // The linear create flow consumes its confirmed `worktree add` milestone
  // here. No `worktreeCreated` authority escapes because no later server owner
  // needs it for invalidation, settlement, or cleanup.
  return { ...withRecoveryMessage(result, 'error.worktree-created-followup-failed'), ok: false }
}

function worktreeRemovedFollowupResult(
  result: RepoMutationExecResult,
  branchEffect: BranchDeleteResult['branchEffect'],
): RepoMutationResult {
  if (result.ok) return { ok: true, message: result.message }
  const recoveryMessages: ExecResultRecoveryMessageKey[] = ['error.worktree-removed-followup-failed']
  if (branchEffect === 'local-delete-confirmed') {
    recoveryMessages.push('error.local-branch-deleted-followup-failed')
  }
  recoveryMessages.push(...(result.recoveryMessageKeys ?? []))
  const recoveryMessageKeys = uniqueRepoMutationRecoveryMessageKeys(recoveryMessages)
  return { ok: false, message: result.message, recoveryMessageKeys }
}

function remoteWorktreeRemovalResultForUser(result: RemoteWorktreeRemovalResult): RepoMutationResult {
  let message = result.message
  if (!result.ok && result.failureExecution) {
    const failure = { ok: false, message: result.message }
    message =
      result.failureStage === 'worktree-remove'
        ? worktreeCommandFailureForUser(failure, result.failureExecution, 'remove').message
        : commandFailureForUser(failure, result.failureExecution).message
  }
  const normalized = { ok: result.ok, message }
  if (result.worktreeRemoved === true) {
    return worktreeRemovedFollowupResult(normalized, result.branchEffect ?? 'none')
  }
  return normalized
}

function publicBranchDeleteResult(result: BranchDeleteResult): RepoMutationExecResult {
  let publicResult: RepoMutationExecResult = result.failureExecution
    ? commandFailureForUser({ ok: result.ok, message: result.message }, result.failureExecution)
    : { ok: result.ok, message: result.message }
  if (!result.ok && result.branchEffect === 'local-delete-confirmed') {
    publicResult = withRecoveryMessage(publicResult, 'error.local-branch-deleted-followup-failed')
  }
  return publicResult
}

async function probeReadableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const value = await fs.stat(cwd)
    if (!value.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fsConstants.R_OK)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
}

function classifyPathProbeError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  return 'error.invalid-path'
}

async function probeGitRepo(cwd: string): Promise<ProbeAvailability> {
  const ok = await isGitRepo(cwd)
  if (ok) return { ok: true }
  const readable = await probeReadableDirectory(cwd)
  if (!readable.ok) return readable
  return { ok: false, message: 'error.workspace-git-unavailable' }
}

function createLocalRepoSource(
  repoId: string,
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability | null = null,
): RepoSource {
  async function validateBranchDeletion(
    branch: string,
    upstream: GitUpstream | null,
    worktreeSnapshots: RepoWorktreeSnapshot[],
    options?: {
      force?: boolean
      notMergedMessage?: 'error.branch-not-fully-merged' | 'error.cannot-remove-unpushed-worktree'
    },
    signal?: AbortSignal,
    ignoredWorktreePath?: string,
    gitCwd = repoId,
  ): Promise<ExecResult | null> {
    const current = await getCurrentBranch(gitCwd, { signal })
    const ignoredPath = ignoredWorktreePath ? path.resolve(ignoredWorktreePath) : null
    const isCheckedOutElsewhere = worktreeSnapshots.some((worktree) => {
      if (repoWorktreeMaterializedBranch(worktree) !== branch) return false
      return ignoredPath ? path.resolve(worktree.path) !== ignoredPath : true
    })
    const mergedToCurrent = !options?.force && current ? await isAncestor(gitCwd, branch, current, signal) : false
    const mergedToUpstream =
      !options?.force && upstream?.ancestryRef ? await isAncestor(gitCwd, branch, upstream.ancestryRef, signal) : false
    return validateBranchDeletionPolicy({
      branch,
      currentBranch: current ?? undefined,
      isCheckedOutElsewhere,
      force: options?.force,
      mergedToCurrent,
      mergedToUpstream,
      notMergedMessage: options?.notMergedMessage,
    })
  }

  async function deleteBranchAfterValidation(
    branch: string,
    upstream: GitUpstream | null,
    options?: { force?: boolean; deleteUpstream?: boolean },
    signal?: AbortSignal,
    gitCwd = repoId,
  ): Promise<BranchDeleteResult> {
    const { result: localDeleteResult, execution: localDeleteExecution } = await deleteBranch(gitCwd, branch, {
      force: options?.force,
      signal,
    })
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
    if (options?.deleteUpstream !== true || !upstream?.deleteTarget) {
      return { ok: true, message: localDeleteResult.message, branchEffect: 'local-delete-confirmed' }
    }
    const { result: upstreamDeleteResult, execution: upstreamDeleteExecution } = await deleteUpstreamBranch(
      gitCwd,
      upstream.deleteTarget.remote,
      upstream.deleteTarget.branch,
      signal,
    )
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

  return {
    id: repoId,
    kind: 'local',
    async getSnapshot(options) {
      if (!isValidCwd(repoId)) return null
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      options?.signal?.throwIfAborted()
      const membership = await readWorktreeMembership(repoId, options?.signal)
      const [sourcePath, worktrees, branches] = await Promise.all([
        resolveGitWorkspacePath(repoId, { signal: options?.signal }),
        readRepoWorktreeSnapshots(repoId, membership, options?.signal),
        getBranches(repoId, { signal: options?.signal }),
      ])
      const sourceWorktree = membership.find((worktree) => path.normalize(worktree.path) === sourcePath)
      if (!sourceWorktree) throw new Error('error.failed-read-repo')
      const current = sourceWorktree.isBare
        ? ((await getCurrentBranch(repoId, { signal: options?.signal })) ?? '')
        : (sourceWorktree.branch ?? '')
      const remote = await getRemoteInfo(repoId, options?.signal)
      options?.signal?.throwIfAborted()
      return { branches, worktrees, current, remote }
    },
    async getWorkspacePaneTargetIdentities(options) {
      const membership = await readWorktreeMembership(repoId, options?.signal)
      options?.signal?.throwIfAborted()
      const worktrees = await readRepoWorktreeSnapshots(repoId, membership, options?.signal)
      return await getBranchWorktreeIdentities(repoId, worktrees, { signal: options?.signal })
    },
    async getStatus(options) {
      if (!isValidCwd(repoId)) throw new Error('error.invalid-path')
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      return await getWorkingStatus(repoId, options)
    },
    async getPullRequests(scope, options) {
      if (!isValidCwd(repoId)) return null
      const branches = scope.kind === 'branch-detail' ? [scope.branch] : undefined
      const branchSet = normalizeRequestedBranches(branches)
      if (branchSet?.size === 0) return []
      const mode: PullRequestFetchMode = scope.kind === 'repository-summary' ? 'summary' : 'full'
      const prs = await getBranchPullRequests(repoId, branchSet, { mode, signal: options?.signal })
      return pullRequestEntries(prs)
    },
    async getLog(target, options) {
      if (!isValidCwd(repoId)) return []
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      return await getGitLog(repoId, target, options?.count, options?.skip, { signal: options?.signal })
    },
    async getRemoteBranches(signal) {
      if (!isValidCwd(repoId)) return []
      return await getLocalRemoteTrackingBranches(repoId, signal)
    },
    async fetch(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const available = await probeGitRepo(repoId)
      if (!available.ok) return available
      const repoIdsToInvalidate = await readLocalRepoIdsToInvalidate(repoId, signal)
      const { result: fetchResult, execution: fetchExecution } = await fetchAll(repoId, signal)
      return withCommandImpact(commandFailureForUser(fetchResult, fetchExecution), fetchExecution, repoIdsToInvalidate)
    },
    async pull(branch, worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const repoIdsToInvalidate = await readLocalRepoIdsToInvalidate(repoId, signal)
      const { result: pullResult, execution: pullExecution } = await pullBranch(repoId, branch, worktreePath, signal)
      return withCommandImpact(commandFailureForUser(pullResult, pullExecution), pullExecution, repoIdsToInvalidate)
    },
    async push(branch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const repoIdsToInvalidate = await readLocalRepoIdsToInvalidate(repoId, signal)
      const { result: pushResult, execution: pushExecution } = await pushBranch(repoId, branch, signal)
      return withCommandImpact(commandFailureForUser(pushResult, pushExecution), pushExecution, repoIdsToInvalidate)
    },
    async getWorktreeBootstrapPreview(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await getLocalWorktreeBootstrapPreview(repoId, { signal })
    },
    async createWorktree(input, signal, options): Promise<CreateWorktreeMutationResult> {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      if (input.mode.kind === 'trackRemoteBranch') {
        const branches = await getLocalRemoteTrackingBranches(repoId, signal)
        if (!hasRemoteTrackingBranch(branches, input.mode.remote)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
      }
      const existingRepoIds = await readLocalRepoIdsToInvalidate(repoId, signal)
      const requestedWorkspaceId = workspaceIdForLocalWorktreePath(input.worktreePath)
      const requestedRepoIds = [...existingRepoIds, ...(requestedWorkspaceId ? [requestedWorkspaceId] : [])]
      const { result: created, execution } = await options.runMembershipMutation(
        async () => await createWorktree(repoId, input, signal),
      )
      if (!created.ok) {
        const failure = worktreeCommandFailureForUser(created, execution, 'create')
        return { ...withCommandImpact(failure, execution, requestedRepoIds), ok: false }
      }
      const canonicalWorktreePath = await getRepoRoot(input.worktreePath, { signal })
      if (!canonicalWorktreePath) {
        return withRepoIdsToInvalidate(
          worktreeCreatedFollowupFailureForUser({ ok: false, message: 'error.failed-read-repo' }),
          requestedRepoIds,
        )
      }
      const createdWorkspaceId = workspaceIdForLocalWorktreePath(canonicalWorktreePath)
      if (!createdWorkspaceId) {
        return withRepoIdsToInvalidate(
          worktreeCreatedFollowupFailureForUser({ ok: false, message: 'error.invalid-path' }),
          requestedRepoIds,
        )
      }
      const repoIdsToInvalidate = [...existingRepoIds, createdWorkspaceId]
      const createdResult = { ...created, ok: true as const, createdWorktreePath: canonicalWorktreePath }
      if (options?.worktreeBootstrap?.kind !== 'run') {
        return withRepoIdsToInvalidate(createdResult, repoIdsToInvalidate)
      }
      const bootstrapped = await bootstrapWorktreeAfterCreate(repoId, canonicalWorktreePath, {
        signal,
        expectedConfigHash: options.worktreeBootstrap.configHash,
      })
      if (!bootstrapped.ok) {
        return withRepoIdsToInvalidate(worktreeCreatedFollowupFailureForUser(bootstrapped), repoIdsToInvalidate)
      }
      return withRepoIdsToInvalidate(
        {
          ok: true,
          message: [created.message, bootstrapped.message].filter(Boolean).join('\n'),
          createdWorktreePath: canonicalWorktreePath,
          ...(bootstrapped.worktreeBootstrap ? { worktreeBootstrap: bootstrapped.worktreeBootstrap } : {}),
        },
        repoIdsToInvalidate,
      )
    },
    async deleteBranch(branch, options, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await readWorktreeMembership(repoId, signal)
      const worktreeSnapshots = await readRepoWorktreeSnapshots(repoId, worktrees, signal)
      const upstream = !options?.force || options?.deleteUpstream ? await getUpstream(repoId, branch, signal) : null
      const validation = await validateBranchDeletion(
        branch,
        upstream,
        worktreeSnapshots,
        { force: options?.force },
        signal,
        undefined,
        repoId,
      )
      if (validation) return validation
      const repoIdsToInvalidate = localRepoIdsToInvalidate(repoId, worktrees)
      const result = await deleteBranchAfterValidation(branch, upstream, options, signal)
      const branchChanged = result.branchEffect !== 'none'
      const publicResult = publicBranchDeleteResult(result)
      return branchChanged ? withRepoIdsToInvalidate(publicResult, repoIdsToInvalidate) : publicResult
    },
    async removeWorktree(input, signal, lifecycle, runMembershipMutation) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await readWorktreeMembership(repoId, signal)
      const repoIdsToInvalidate = localRepoIdsToInvalidate(repoId, worktrees)
      const mainWorktreePath = worktrees.find((wt) => wt.isPrimary)?.path ?? worktrees[0]?.path ?? ''
      const exactExecution = physicalWorktreeCapability
        ? physicalWorktreeExecutionBinding(physicalWorktreeCapability)
        : null
      const requestedPath = exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : input.worktreePath
      const removable = resolveRemovableWorktree(worktrees, requestedPath, mainWorktreePath)
      if (!removable.ok) return { ok: false, message: removable.message }
      const worktreeSnapshots = await readRepoWorktreeSnapshots(repoId, worktrees, signal)
      const branchWorktree = repoWorktreeForBranch(worktreeSnapshots, input.branch)
      if (!branchWorktree || path.resolve(branchWorktree.path) !== path.resolve(removable.target.path)) {
        return { ok: false, message: 'error.worktree-not-found-for-branch' }
      }
      if (branchWorktree.operation !== null) {
        return { ok: false, message: 'error.cannot-remove-worktree-operation-in-progress' }
      }
      if (removable.target.isLocked === true) {
        return { ok: false, message: 'error.cannot-remove-locked-worktree' }
      }
      const targetStatus = await sampleWorktreeStatusForTarget(removable.target, signal)
      const statusAwareTarget =
        targetStatus.kind === 'status'
          ? {
              ...targetStatus.worktree,
              isDirty: targetStatus.entries.length > 0,
            }
          : targetStatus.worktree
      const mutationCwd =
        path.resolve(removable.target.path) === path.resolve(repoId) && mainWorktreePath ? mainWorktreePath : repoId
      const invalid = validateRemovableWorktreeState(statusAwareTarget)
      if (invalid) return invalid
      const upstream =
        input.deleteBranch && (!input.forceDeleteBranch || input.deleteUpstream)
          ? await getUpstream(mutationCwd, input.branch, signal)
          : null
      if (input.deleteBranch) {
        const validation = await validateBranchDeletion(
          input.branch,
          upstream,
          worktreeSnapshots,
          { force: input.forceDeleteBranch, notMergedMessage: 'error.cannot-remove-unpushed-worktree' },
          signal,
          removable.target.path,
          mutationCwd,
        )
        if (validation) return validation
      }
      const prepared = await lifecycle.beforeRemove()
      if (!prepared.ok) return prepared
      const { result: removed, execution: removeExecution } = await runMembershipMutation(
        async () =>
          await removeWorktree(
            mutationCwd,
            exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : removable.target.path,
            signal,
          ),
      )
      if (!removed.ok) {
        const failure = worktreeCommandFailureForUser(removed, removeExecution, 'remove')
        return withCommandImpact(failure, removeExecution, repoIdsToInvalidate)
      }
      const finalized = await lifecycle.afterWorktreeRemoved()
      if (!finalized.ok) {
        return withRepoIdsToInvalidate(worktreeRemovedFollowupResult(finalized, 'none'), repoIdsToInvalidate)
      }
      if (!input.deleteBranch)
        return withRepoIdsToInvalidate(worktreeRemovedFollowupResult(removed, 'none'), repoIdsToInvalidate)
      const deletedWithMilestone = await deleteBranchAfterValidation(
        input.branch,
        upstream,
        { force: input.forceDeleteBranch, deleteUpstream: input.deleteUpstream },
        signal,
        mutationCwd,
      )
      const publicBranchResult = publicBranchDeleteResult(deletedWithMilestone)
      const removalResult = worktreeRemovedFollowupResult(publicBranchResult, deletedWithMilestone.branchEffect)
      return withRepoIdsToInvalidate(removalResult, repoIdsToInvalidate)
    },
    async getPatch(worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await readWorktreeMembership(repoId, signal)
      const known = resolveKnownWorktree(worktrees, worktreePath)
      if (!known.ok) return { ok: false, message: known.message }
      try {
        return { ok: true, message: await getWorktreePatch(known.path, { signal }) }
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
      }
    },
    async getBrowserRepoUrl(target, signal) {
      return await getBrowserRepoUrl(repoId, target, { signal })
    },
  }
}

async function createRemoteRepoSource(
  repoId: string,
  capturedTarget?: RemoteWorkspaceTarget,
  physicalWorktreeCapability: PhysicalWorktreeExecutionCapability | null = null,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoSource> {
  const target = capturedTarget ?? (await resolveRemoteWorkspaceTarget(repoId, runtime, signal))
  const run = runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined
  return {
    id: repoId,
    kind: 'remote',
    async getSnapshot(options) {
      const remoteSnapshot = await getRemoteSnapshot(target, { ...options, run })
      options?.signal?.throwIfAborted()
      return remoteSnapshot
    },
    async getWorkspacePaneTargetIdentities(options) {
      return await getRemoteWorkspacePaneTargetIdentities(target, { ...options, run })
    },
    async getStatus(options) {
      return await getRemoteStatus(target, { ...options, run })
    },
    async getPullRequests(scope, options) {
      const branches = scope.kind === 'branch-detail' ? [scope.branch] : undefined
      const branchSet = normalizeRequestedBranches(branches)
      if (branchSet?.size === 0) return []
      const repo = await remotePullRequestRepoRef(target, { signal: options?.signal, run })
      if (!repo) return null
      const prs = await getBranchPullRequestsForRepoRef(repoId, repo, branchSet, {
        mode: scope.kind === 'repository-summary' ? 'summary' : 'full',
        signal: options?.signal,
      })
      return pullRequestEntries(prs)
    },
    async getLog(logTarget, options) {
      return await getRemoteLog(target, logTarget, options?.count, options?.skip, { signal: options?.signal, run })
    },
    async getRemoteBranches(signal) {
      return await getSshRemoteTrackingBranches(target, { signal, run })
    },
    async fetch(signal) {
      return await runRemoteRepoMutation(repoId, target, runtime, run, async (mutationRun) => {
        const repoIdsToInvalidate = await readRemoteRepoIdsToInvalidate(target, signal, mutationRun)
        const { result: fetchResult, execution: fetchExecution } = await fetchRemoteRepo(target, {
          signal,
          run: mutationRun,
        })
        return withCommandImpact(
          commandFailureForUser(fetchResult, fetchExecution),
          fetchExecution,
          repoIdsToInvalidate,
        )
      })
    },
    async pull(branch, worktreePath, signal) {
      return await runRemoteRepoMutation(repoId, target, runtime, run, async (mutationRun) => {
        const repoIdsToInvalidate = await readRemoteRepoIdsToInvalidate(target, signal, mutationRun)
        const { result: pullResult, execution: pullExecution } = await pullRemoteBranch(target, branch, worktreePath, {
          signal,
          run: mutationRun,
        })
        return withCommandImpact(commandFailureForUser(pullResult, pullExecution), pullExecution, repoIdsToInvalidate)
      })
    },
    async push(branch, signal) {
      return await runRemoteRepoMutation(repoId, target, runtime, run, async (mutationRun) => {
        const repoIdsToInvalidate = await readRemoteRepoIdsToInvalidate(target, signal, mutationRun)
        const { result: pushResult, execution: pushExecution } = await pushRemoteBranch(target, branch, {
          signal,
          run: mutationRun,
        })
        return withCommandImpact(commandFailureForUser(pushResult, pushExecution), pushExecution, repoIdsToInvalidate)
      })
    },
    async getWorktreeBootstrapPreview(signal) {
      return await getRemoteWorktreeBootstrapPreview(target, { signal, run })
    },
    async createWorktree(input, signal, options): Promise<CreateWorktreeMutationResult> {
      return await runRemoteRepoMutation<CreateWorktreeMutationResult>(
        repoId,
        target,
        runtime,
        run,
        async (mutationRun) => {
          if (input.mode.kind === 'trackRemoteBranch') {
            const branches = await getSshRemoteTrackingBranches(target, { signal, run: mutationRun })
            if (!hasRemoteTrackingBranch(branches, input.mode.remote)) {
              return { ok: false, message: 'error.invalid-arguments' }
            }
          }
          const existingRepoIds = await readRemoteRepoIdsToInvalidate(target, signal, mutationRun)
          const membershipRun = remoteMembershipMutationRunner(mutationRun, options.runMembershipMutation)
          const { result: created, execution } = await createRemoteWorktree(target, {
            ...input,
            signal,
            run: membershipRun,
          })
          const requestedRepoIds = [...existingRepoIds, ...remoteWorktreeRepoIds(target, [input.worktreePath])]
          if (!created.ok) {
            const failure = worktreeCommandFailureForUser(created, execution, 'create')
            return { ...withCommandImpact(failure, execution, requestedRepoIds), ok: false }
          }
          const canonicalWorktreePath = await resolveRemoteWorktreePath(target, input.worktreePath, {
            signal,
            run: mutationRun,
          })
          if (!canonicalWorktreePath) {
            return withRepoIdsToInvalidate(
              worktreeCreatedFollowupFailureForUser({
                ok: false,
                message: 'error.failed-read-repo',
              }),
              requestedRepoIds,
            )
          }
          const canonicalRepoIds = remoteWorktreeRepoIds(target, [canonicalWorktreePath])
          if (canonicalRepoIds.length !== 1) {
            return withRepoIdsToInvalidate(
              worktreeCreatedFollowupFailureForUser({ ok: false, message: 'error.invalid-path' }),
              requestedRepoIds,
            )
          }
          const repoIdsToInvalidate = [...existingRepoIds, ...canonicalRepoIds]
          const createdResult = { ...created, ok: true as const, createdWorktreePath: canonicalWorktreePath }
          if (options?.worktreeBootstrap?.kind !== 'run') {
            return withRepoIdsToInvalidate(createdResult, repoIdsToInvalidate)
          }
          const bootstrapped = await bootstrapRemoteWorktreeAfterCreate(target, canonicalWorktreePath, {
            signal,
            run: mutationRun,
            expectedConfigHash: options.worktreeBootstrap.configHash,
          })
          if (!bootstrapped.ok) {
            return withRepoIdsToInvalidate(worktreeCreatedFollowupFailureForUser(bootstrapped), repoIdsToInvalidate)
          }
          return withRepoIdsToInvalidate(
            {
              ok: true,
              message: [created.message, bootstrapped.message].filter(Boolean).join('\n'),
              createdWorktreePath: canonicalWorktreePath,
              ...(bootstrapped.worktreeBootstrap ? { worktreeBootstrap: bootstrapped.worktreeBootstrap } : {}),
            },
            repoIdsToInvalidate,
          )
        },
      )
    },
    async deleteBranch(branch, options, signal) {
      return await runRemoteRepoMutation(repoId, target, runtime, run, async (mutationRun) => {
        const repoIdsToInvalidate = await readRemoteRepoIdsToInvalidate(target, signal, mutationRun)
        const result = await deleteRemoteBranch(target, {
          branch,
          force: options?.force,
          deleteUpstream: options?.deleteUpstream,
          signal,
          run: mutationRun,
        })
        const branchChanged = result.branchEffect !== 'none'
        const publicResult = publicBranchDeleteResult(result)
        return branchChanged ? withRepoIdsToInvalidate(publicResult, repoIdsToInvalidate) : publicResult
      })
    },
    async removeWorktree(input, signal, lifecycle, runMembershipMutation) {
      return await runRemoteRepoMutation(repoId, target, runtime, run, async (mutationRun) => {
        const exactExecution = physicalWorktreeCapability
          ? physicalWorktreeExecutionBinding(physicalWorktreeCapability)
          : null
        const membershipRun = remoteMembershipMutationRunner(mutationRun, runMembershipMutation)
        const result = await removeRemoteWorktree(target, {
          ...input,
          worktreePath: exactExecution?.kind === 'remote' ? exactExecution.canonicalWorktreePath : input.worktreePath,
          signal,
          run: membershipRun,
          beforeRemove: lifecycle.beforeRemove,
          afterWorktreeRemoved: lifecycle.afterWorktreeRemoved,
        })
        const userResult = remoteWorktreeRemovalResultForUser(result)
        if (!result.worktreePathsToInvalidate?.length && result.worktreeRemoved !== true) return userResult
        return withRepoIdsToInvalidate(userResult, [
          target.id,
          ...remoteWorktreeRepoIds(target, result.worktreePathsToInvalidate),
        ])
      })
    },
    async getPatch(worktreePath, signal) {
      return await getRemotePatch(target, worktreePath, { signal, run })
    },
    async getBrowserRepoUrl(urlTarget, signal) {
      return await getRemoteBrowserUrl(target, urlTarget, { signal, run })
    },
  }
}

function preferredGitHubRepoRef(
  remotes: Array<{ name: string; fetchUrl: string; pushUrl: string }>,
): GitHubRepoRef | null {
  const githubRemotes = remotes
    .map((remote) => ({ name: remote.name, repo: parseGitHubRemoteUrl(remote.fetchUrl) }))
    .filter((remote): remote is { name: string; repo: GitHubRepoRef } => remote.repo !== null)
  return pickPreferredRemote(githubRemotes)?.repo ?? null
}

function normalizeRequestedBranches(branches?: string[]): ReadonlySet<string> | undefined {
  if (branches === undefined) return undefined
  if (!Array.isArray(branches)) return undefined
  return new Set(
    branches.filter((branch): branch is string => {
      return typeof branch === 'string' && branch.length > 0
    }),
  )
}

function pullRequestEntries(prs: Map<string, PullRequestInfo> | null): PullRequestEntry[] | null {
  return prs ? Array.from(prs, ([branch, pullRequest]) => ({ branch, pullRequest })) : null
}

function hasRemoteTrackingBranch(
  branches: readonly RemoteTrackingBranchIdentity[],
  candidate: RemoteTrackingBranchIdentity,
): boolean {
  return branches.some(
    (branch) =>
      branch.ref === candidate.ref && branch.remote === candidate.remote && branch.branch === candidate.branch,
  )
}

async function remotePullRequestRepoRef(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<GitHubRepoRef | null> {
  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run: options.run })
  if (!snapshot?.remote.hasGitHubRemote) return null
  return preferredGitHubRepoRef(snapshot.remote.remotes)
}
