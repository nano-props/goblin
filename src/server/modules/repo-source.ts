import path from 'node:path'
import { constants as fsConstants, promises as fs } from 'node:fs'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { RepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import {
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
  localWorktreeRepoIds,
  remoteWorktreeRepoIds,
  withAffectedRepoIds,
  withAffectedRepoIdsIfChanged,
  workspaceIdForLocalWorktreePath,
  type RepoMutationResult,
} from '#/server/modules/repo-mutation-impact.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  deleteBranch,
  deleteUpstreamBranch,
  getBranchWorktreeIdentities,
  getBranches,
  getCurrentBranch,
  getHeadHash,
  getLog as getBranchLog,
  getUpstream,
  isAncestor,
  isGitRepo,
} from '#/system/git/branches.ts'
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
  type LogEntry,
  type PullRequestFetchMode,
  type PullRequestInfo,
  type RepoUrlTarget,
  type WorktreeInfo,
  type WorktreeStatus,
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
  getRemoteWorkspacePaneTargetIdentities,
  getRemoteSnapshot,
  getRemoteStatus,
  getRemoteWorktreeBootstrapPreview,
  getRemoteTrackingBranches as getSshRemoteTrackingBranches,
  type RemoteGitRunner,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
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

export type WorkspacePaneTargetIdentity =
  { kind: 'git-branch'; branchName: string } | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

export interface RepoSource {
  id: string
  kind: 'local' | 'remote'
  getSnapshot(signal?: AbortSignal): Promise<RepoSnapshot | null>
  getWorkspacePaneTargetIdentities(signal?: AbortSignal): Promise<WorkspacePaneTargetIdentity[]>
  getStatus(signal?: AbortSignal): Promise<WorktreeStatus[]>
  getPullRequests(scope: RepoPullRequestScope, options?: { signal?: AbortSignal }): Promise<PullRequestEntry[] | null>
  getLog(branch: string, options?: { count?: number; skip?: number; signal?: AbortSignal }): Promise<LogEntry[]>
  getRemoteBranches(signal?: AbortSignal): Promise<RemoteTrackingBranchIdentity[]>
  fetch(signal: AbortSignal): Promise<RepoMutationResult>
  pull(branch: string, worktreePath?: string, signal?: AbortSignal): Promise<RepoMutationResult>
  push(branch: string, signal?: AbortSignal): Promise<RepoMutationResult>
  getWorktreeBootstrapPreview(signal?: AbortSignal): Promise<WorktreeBootstrapPreviewResult>
  createWorktree(
    input: CreateWorktreeInput,
    signal?: AbortSignal,
    options?: { worktreeBootstrap?: WorktreeBootstrapDecision },
  ): Promise<RepoMutationResult>
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

async function readLocalAffectedRepoIds(repoId: string, signal?: AbortSignal): Promise<WorkspaceId[]> {
  const worktrees = await readWorktreeMembership(repoId, signal)
  signal?.throwIfAborted()
  return localWorktreeRepoIds(worktrees)
}

async function readRemoteAffectedRepoIds(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
  run?: RemoteGitRunner,
): Promise<WorkspaceId[]> {
  const worktreePaths = await getRemoteRepoWorktreePaths(target, { signal, run })
  signal?.throwIfAborted()
  return remoteWorktreeRepoIds(target, worktreePaths)
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
    options?: {
      force?: boolean
      notMergedMessage?: 'error.branch-not-fully-merged' | 'error.cannot-remove-unpushed-worktree'
    },
    signal?: AbortSignal,
    ignoredWorktreePath?: string,
    gitCwd = repoId,
    knownWorktrees?: WorktreeInfo[],
  ): Promise<ExecResult | null> {
    const current = await getCurrentBranch(gitCwd, { signal })
    const worktrees = knownWorktrees ?? (await readWorktreeMembership(gitCwd, signal))
    const ignoredPath = ignoredWorktreePath ? path.resolve(ignoredWorktreePath) : null
    const isCheckedOutElsewhere = worktrees.some((wt) => {
      if (wt.branch !== branch) return false
      return ignoredPath ? path.resolve(wt.path) !== ignoredPath : true
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
  ): Promise<ExecResult> {
    const deleted = await deleteBranch(gitCwd, branch, { force: options?.force, signal })
    if (!deleted.ok || options?.deleteUpstream !== true || !upstream?.deleteTarget) return deleted
    const upstreamDeleted = await deleteUpstreamBranch(
      gitCwd,
      upstream.deleteTarget.remote,
      upstream.deleteTarget.branch,
      signal,
    )
    return upstreamDeleted.ok ? upstreamDeleted : { ...upstreamDeleted, repositoryStateChanged: true }
  }

  return {
    id: repoId,
    kind: 'local',
    async getSnapshot(signal) {
      if (!isValidCwd(repoId)) return null
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      signal?.throwIfAborted()
      const membership = await readWorktreeMembership(repoId, signal)
      const currentBranch = await getCurrentBranch(repoId, { signal })
      const branches = await getBranches(repoId, membership, currentBranch, { signal })
      const current = currentBranch ?? ''
      const currentHEAD = currentBranch === null ? await getHeadHash(repoId, { signal }) : undefined
      const remote = await getRemoteInfo(repoId, signal)
      signal?.throwIfAborted()
      return { branches, current, currentHEAD, remote }
    },
    async getWorkspacePaneTargetIdentities(signal) {
      const worktrees = await readWorktreeMembership(repoId, signal)
      signal?.throwIfAborted()
      return await getBranchWorktreeIdentities(repoId, worktrees, { signal })
    },
    async getStatus(signal) {
      if (!isValidCwd(repoId)) throw new Error('error.invalid-path')
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      return await getWorkingStatus(repoId, { signal })
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
    async getLog(branch, options) {
      if (!isValidCwd(repoId)) return []
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      return await getBranchLog(repoId, branch, options?.count, options?.skip, { signal: options?.signal })
    },
    async getRemoteBranches(signal) {
      if (!isValidCwd(repoId)) return []
      return await getLocalRemoteTrackingBranches(repoId, signal)
    },
    async fetch(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const available = await probeGitRepo(repoId)
      if (!available.ok) return available
      const affectedRepoIds = await readLocalAffectedRepoIds(repoId, signal)
      const fetched = await fetchAll(repoId, signal)
      return withAffectedRepoIdsIfChanged(fetched, affectedRepoIds)
    },
    async pull(branch, worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const affectedRepoIds = await readLocalAffectedRepoIds(repoId, signal)
      const pulled = await pullBranch(repoId, branch, worktreePath, signal)
      return withAffectedRepoIdsIfChanged(pulled, affectedRepoIds)
    },
    async push(branch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const affectedRepoIds = await readLocalAffectedRepoIds(repoId, signal)
      const pushed = await pushBranch(repoId, branch, signal)
      return pushed.ok ? withAffectedRepoIds(pushed, affectedRepoIds) : pushed
    },
    async getWorktreeBootstrapPreview(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await getLocalWorktreeBootstrapPreview(repoId, { signal })
    },
    async createWorktree(input, signal, options) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      if (input.mode.kind === 'trackRemoteBranch') {
        const branches = await getLocalRemoteTrackingBranches(repoId, signal)
        if (!hasRemoteTrackingBranch(branches, input.mode.remote)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
      }
      const createdWorkspaceId = workspaceIdForLocalWorktreePath(input.worktreePath)
      const affectedRepoIds = [
        ...(await readLocalAffectedRepoIds(repoId, signal)),
        ...(createdWorkspaceId ? [createdWorkspaceId] : []),
      ]
      const created = await createWorktree(repoId, input, signal)
      if (!created.ok) return withAffectedRepoIdsIfChanged(created, affectedRepoIds)
      if (options?.worktreeBootstrap?.kind !== 'run') return withAffectedRepoIds(created, affectedRepoIds)
      const bootstrapped = await bootstrapWorktreeAfterCreate(repoId, input.worktreePath, {
        signal,
        expectedConfigHash: options.worktreeBootstrap.configHash,
      })
      const result = bootstrapped.ok
        ? {
            ok: true,
            message: [created.message, bootstrapped.message].filter(Boolean).join('\n'),
            ...(bootstrapped.worktreeBootstrap ? { worktreeBootstrap: bootstrapped.worktreeBootstrap } : {}),
          }
        : { ...bootstrapped, repositoryStateChanged: true }
      return withAffectedRepoIds(result, affectedRepoIds)
    },
    async deleteBranch(branch, options, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await readWorktreeMembership(repoId, signal)
      const upstream = !options?.force || options?.deleteUpstream ? await getUpstream(repoId, branch, signal) : null
      const validation = await validateBranchDeletion(
        branch,
        upstream,
        { force: options?.force },
        signal,
        undefined,
        repoId,
        worktrees,
      )
      if (validation) return validation
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const deleted = await deleteBranchAfterValidation(branch, upstream, options, signal)
      return withAffectedRepoIdsIfChanged(deleted, affectedRepoIds)
    },
    async removeWorktree(input, signal, lifecycle) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await readWorktreeMembership(repoId, signal)
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const mainWorktreePath = worktrees.find((wt) => wt.isPrimary)?.path ?? worktrees[0]?.path ?? ''
      const exactExecution = physicalWorktreeCapability
        ? physicalWorktreeExecutionBinding(physicalWorktreeCapability)
        : null
      const requestedPath = exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : input.worktreePath
      const removable = resolveRemovableWorktree(worktrees, input.branch, requestedPath, mainWorktreePath)
      if (!removable.ok) return { ok: false, message: removable.message }
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
          { force: input.forceDeleteBranch, notMergedMessage: 'error.cannot-remove-unpushed-worktree' },
          signal,
          removable.target.path,
          mutationCwd,
          worktrees,
        )
        if (validation) return validation
      }
      const prepared = await lifecycle.beforeRemove()
      if (!prepared.ok) return prepared
      const removed = await removeWorktree(
        mutationCwd,
        exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : removable.target.path,
        signal,
      )
      if (!removed.ok) return removed
      const finalized = await lifecycle.afterWorktreeRemoved()
      if (!finalized.ok) return withAffectedRepoIds({ ...finalized, repositoryStateChanged: true }, affectedRepoIds)
      if (!input.deleteBranch) return withAffectedRepoIds(removed, affectedRepoIds)
      const deleted = await deleteBranchAfterValidation(
        input.branch,
        upstream,
        { force: input.forceDeleteBranch, deleteUpstream: input.deleteUpstream },
        signal,
        mutationCwd,
      )
      return withAffectedRepoIds(deleted.ok ? deleted : { ...deleted, repositoryStateChanged: true }, affectedRepoIds)
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
    async getSnapshot(signal) {
      const remoteSnapshot = await getRemoteSnapshot(target, { signal, run })
      signal?.throwIfAborted()
      return { branches: remoteSnapshot.branches, current: remoteSnapshot.current, remote: remoteSnapshot.remote }
    },
    async getWorkspacePaneTargetIdentities(signal) {
      return await getRemoteWorkspacePaneTargetIdentities(target, { signal, run })
    },
    async getStatus(signal) {
      return await getRemoteStatus(target, { signal, run })
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
    async getLog(branch, options) {
      return await getRemoteLog(target, branch, options?.count, options?.skip, { signal: options?.signal, run })
    },
    async getRemoteBranches(signal) {
      return await getSshRemoteTrackingBranches(target, { signal, run })
    },
    async fetch(signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const fetched = await fetchRemoteRepo(target, { signal, run })
      return withAffectedRepoIdsIfChanged(fetched, affectedRepoIds)
    },
    async pull(branch, worktreePath, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const pulled = await pullRemoteBranch(target, branch, worktreePath, { signal, run })
      return withAffectedRepoIdsIfChanged(pulled, affectedRepoIds)
    },
    async push(branch, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const pushed = await pushRemoteBranch(target, branch, { signal, run })
      return pushed.ok ? withAffectedRepoIds(pushed, affectedRepoIds) : pushed
    },
    async getWorktreeBootstrapPreview(signal) {
      return await getRemoteWorktreeBootstrapPreview(target, { signal, run })
    },
    async createWorktree(input, signal, options) {
      if (input.mode.kind === 'trackRemoteBranch') {
        const branches = await getSshRemoteTrackingBranches(target, { signal, run })
        if (!hasRemoteTrackingBranch(branches, input.mode.remote)) {
          return { ok: false, message: 'error.invalid-arguments' }
        }
      }
      const existingRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const created = await createRemoteWorktree(target, { ...input, signal, run })
      const affectedRepoIds = [...existingRepoIds, ...remoteWorktreeRepoIds(target, created.affectedWorktreePaths)]
      if (!created.ok) return withAffectedRepoIdsIfChanged(created, affectedRepoIds)
      if (options?.worktreeBootstrap?.kind !== 'run') return withAffectedRepoIds(created, affectedRepoIds)
      const bootstrapped = await bootstrapRemoteWorktreeAfterCreate(target, input.worktreePath, {
        signal,
        run,
        expectedConfigHash: options.worktreeBootstrap.configHash,
      })
      if (!bootstrapped.ok)
        return withAffectedRepoIds({ ...bootstrapped, repositoryStateChanged: true }, affectedRepoIds)
      return withAffectedRepoIds(
        {
          ok: true,
          message: [created.message, bootstrapped.message].filter(Boolean).join('\n'),
          ...(bootstrapped.worktreeBootstrap ? { worktreeBootstrap: bootstrapped.worktreeBootstrap } : {}),
        },
        affectedRepoIds,
      )
    },
    async deleteBranch(branch, options, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const deleted = await deleteRemoteBranch(target, {
        branch,
        force: options?.force,
        deleteUpstream: options?.deleteUpstream,
        signal,
        run,
      })
      return withAffectedRepoIdsIfChanged(deleted, affectedRepoIds)
    },
    async removeWorktree(input, signal, lifecycle) {
      const exactExecution = physicalWorktreeCapability
        ? physicalWorktreeExecutionBinding(physicalWorktreeCapability)
        : null
      const result = await removeRemoteWorktree(target, {
        ...input,
        worktreePath: exactExecution?.kind === 'remote' ? exactExecution.canonicalWorktreePath : input.worktreePath,
        signal,
        run,
        beforeRemove: lifecycle.beforeRemove,
        afterWorktreeRemoved: lifecycle.afterWorktreeRemoved,
      })
      return withAffectedRepoIds(result, remoteWorktreeRepoIds(target, result.affectedWorktreePaths))
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
