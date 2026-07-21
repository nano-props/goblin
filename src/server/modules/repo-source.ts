import path from 'node:path'
import { constants as fsConstants, promises as fs } from 'node:fs'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { RepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import { RepositoryTargetChangedError } from '#/server/modules/repository-target-changed-error.ts'
import type { GitHead } from '#/shared/git-head.ts'
import {
  deleteBranch,
  deleteUpstreamBranch,
  getBranchWorktreeIdentities,
  getBranches,
  getCurrentBranch,
  resolveRepoCommonDir,
  resolveRepoObjectsDir,
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
import { getWorkingStatus } from '#/system/git/status.ts'
import { createWorktree, getWorktrees, removeWorktree } from '#/system/git/worktrees.ts'
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
import { resolveRemoteTarget as resolveSshRemoteTarget } from '#/system/ssh/config.ts'
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
  resolveRemoteRepoExecutionIdentity,
  getRemoteSnapshot,
  getRemoteStatus,
  getRemoteWorktreeBootstrapPreview,
  getRemoteTrackingBranches as getSshRemoteTrackingBranches,
  type RemoteGitRunner,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { getBranchPullRequests, getBranchPullRequestsForRepoRef } from '#/system/git/pull-requests.ts'
import { parseGitHubRemoteUrl, type GitHubRepoRef } from '#/system/github/graphql.ts'
import {
  isRemoteWorkspaceId,
  parseRemoteWorkspaceId,
  type PullRequestEntry,
  type RemoteWorkspaceTarget,
  type RepoSnapshot,
} from '#/shared/api-types.ts'
import { normalizeRemoteWorkspaceRef } from '#/shared/remote-workspace.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import {
  isRemoteWorkspaceRuntimeFailure,
  remoteWorkspaceRuntimeFailureFromCommandResult,
  remoteWorkspaceRuntimeFailureFromTargetResolutionError,
} from '#/server/modules/remote-workspace-runtime-failure.ts'
import {
  formatWorkspaceLocator,
  parseWorkspaceLocator,
  type WorkspaceId,
  type WorkspaceLocatorPlatform,
} from '#/shared/workspace-locator.ts'
import {
  physicalWorktreeExecutionBinding,
  validatePhysicalWorktreeExecution,
  type PhysicalWorktreeExecutionCapability,
} from '#/server/worktree-removal/physical-worktree-capability.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

type RepoWriteBoundary =
  | { kind: 'local-git'; commonDir: string; generationKey: string }
  | { kind: 'remote-git'; executionIdentity: string; generationKey: string }

export interface RepoMutationResult extends ExecResult {
  /**
   * Repo session ids whose repo snapshot changed even when the final
   * command result is a partial failure after an earlier write succeeded.
   */
  affectedRepoIds?: readonly WorkspaceId[]
  /** Filesystem roots whose checked-out contents changed during the mutation. */
  affectedWorktreePaths?: readonly string[]
}

export type WorkspacePaneTargetIdentity =
  { kind: 'git-branch'; branchName: string } | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

export interface RepoSource {
  id: string
  kind: 'local' | 'remote'
  getSnapshot(signal?: AbortSignal): Promise<RepoSnapshot | null>
  getWorkspacePaneTargetIdentities(signal?: AbortSignal): Promise<WorkspacePaneTargetIdentity[]>
  getStatus(signal?: AbortSignal): Promise<WorktreeStatus[]>
  getPullRequests(
    branches?: string[],
    options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
  ): Promise<PullRequestEntry[] | null>
  getLog(branch: string, options?: { count?: number; skip?: number; signal?: AbortSignal }): Promise<LogEntry[]>
  getRemoteBranches(signal?: AbortSignal): Promise<string[]>
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

interface RepoSourceCapabilities {
  pullRequests: 'cwd-github' | 'derived-github-repo'
}

export interface RepoSourceRuntimeContext {
  workspaceRuntimeId: string
}

declare const repoWriteExecutionCapabilityBrand: unique symbol

export interface RepoWriteExecutionCapability {
  readonly [repoWriteExecutionCapabilityBrand]: true
}

interface RepoWriteExecutionState {
  coordinationKey: string
  repositoryKey: string
  source: RepoSource
  validate(signal?: AbortSignal): Promise<boolean>
}

interface RepoWriteExecutionSnapshot {
  coordinationKey: string
  repositoryKey: string
  executionIdentity: string
  source: RepoSource
}

interface LocalRepoExecutionSnapshot {
  boundary: Extract<RepoWriteBoundary, { kind: 'local-git' }>
  canonicalRepoPath: string
}

const repoWriteExecutions = new WeakMap<RepoWriteExecutionCapability, RepoWriteExecutionState>()

export async function resolveRemoteWorkspaceTarget(
  repoId: string,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RemoteWorkspaceTarget> {
  try {
    const parsed = parseRemoteWorkspaceId(repoId)
    if (!parsed) throw new Error('error.ssh-config-changed')
    return (await resolveSshRemoteTarget(parsed, signal)).target
  } catch (err) {
    if (!runtime) throw err
    throw remoteWorkspaceRuntimeFailureFromTargetResolutionError({
      workspaceId: repoId,
      workspaceRuntimeId: runtime.workspaceRuntimeId,
      error: err,
    })
  }
}

export async function runWithRepoSource<T>(
  cwd: WorkspaceId,
  task: (source: Awaited<ReturnType<typeof resolveRepoSource>>) => Promise<T>,
  runtime?: RepoSourceRuntimeContext,
): Promise<T> {
  return await task(await resolveRepoSource(cwd, runtime))
}

export async function resolveRepoSource(repoId: WorkspaceId, runtime?: RepoSourceRuntimeContext): Promise<RepoSource> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator) throw new Error('error.workspace-locator-malformed')
  return locator.transport === 'ssh'
    ? await createRemoteRepoSource(repoId, undefined, null, runtime)
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
    const coordinationKey = repoWriteBoundaryCoordinationKey(execution.boundary)
    return {
      coordinationKey,
      repositoryKey: repoWriteBoundaryRepositoryKey(execution.boundary),
      executionIdentity: JSON.stringify({
        coordinationKey,
        canonicalRepoPath: execution.canonicalRepoPath,
        generationKey: execution.boundary.generationKey,
      }),
      source: createLocalRepoSource(execution.canonicalRepoPath),
    }
  }

  const target = await resolveRemoteWorkspaceTarget(repoId, runtime, signal)
  const run = runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined
  const boundary = await resolveRemoteRepoWriteBoundaryForTarget(target, signal, run)
  const coordinationKey = repoWriteBoundaryCoordinationKey(boundary)
  return {
    coordinationKey,
    repositoryKey: repoWriteBoundaryRepositoryKey(boundary),
    executionIdentity: JSON.stringify({
      coordinationKey,
      generationKey: boundary.generationKey,
      alias: target.alias,
      destination: target.sshConnection?.destination,
      host: target.host,
      user: target.user,
      port: target.port,
      options: target.sshConnection?.options ?? [],
    }),
    source: await createRemoteRepoSource(repoId, target, null, runtime),
  }
}

export async function captureRepoWriteExecution(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteExecutionCapability> {
  // Queue identity and execution source come from one strict capture. Validation
  // may reject a changed target, but execution never re-resolves or falls back.
  const captured = await resolveRepoWriteExecutionState(repoId, runtime, signal)
  const state: RepoWriteExecutionState = {
    ...captured,
    async validate(validationSignal) {
      const current = await resolveRepoWriteExecutionState(repoId, runtime, validationSignal)
      return current.executionIdentity === captured.executionIdentity
    },
  }
  const capability = Object.freeze({}) as RepoWriteExecutionCapability
  repoWriteExecutions.set(capability, state)
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
  const capturedLocatorRepositoryKey = repoWriteBoundaryRepositoryKey(capturedLocatorBoundary)
  const capturedPhysicalRepositoryKey = repoWriteBoundaryRepositoryKey(boundary)
  if (capturedLocatorRepositoryKey !== capturedPhysicalRepositoryKey) throw new RepositoryTargetChangedError()
  const source =
    execution.kind === 'remote'
      ? await createRemoteRepoSource(repoId, execution.target, physicalWorktreeCapability, runtime)
      : createLocalRepoSource(execution.canonicalWorktreePath, physicalWorktreeCapability)
  const state: RepoWriteExecutionState = {
    coordinationKey: repoWriteBoundaryCoordinationKey(boundary),
    repositoryKey: capturedPhysicalRepositoryKey,
    source,
    async validate(validationSignal) {
      await validatePhysicalWorktreeExecution(physicalWorktreeCapability, validationSignal)
      const currentLocatorBoundary = await resolveRepoWriteBoundaryForLocator(repoId, runtime, validationSignal)
      const currentBoundary =
        execution.kind === 'remote'
          ? await resolveRemoteRepoWriteBoundaryForTarget(
              execution.target,
              validationSignal,
              runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, execution.target) : undefined,
            )
          : await resolveLocalRepoWriteBoundaryForPath(execution.canonicalWorktreePath, validationSignal)
      return (
        repoWriteBoundaryRepositoryKey(currentLocatorBoundary) === capturedLocatorRepositoryKey &&
        repoWriteBoundaryRepositoryKey(currentBoundary) === capturedPhysicalRepositoryKey
      )
    },
  }
  const capability = Object.freeze({}) as RepoWriteExecutionCapability
  repoWriteExecutions.set(capability, state)
  return capability
}

export function repoWriteExecutionBoundaryKey(capability: RepoWriteExecutionCapability): string {
  return repoWriteExecutionState(capability).repositoryKey
}

export function repoWriteExecutionCoordinationKey(capability: RepoWriteExecutionCapability): string {
  return repoWriteExecutionState(capability).coordinationKey
}

export async function runWithCapturedRepoWriteExecution<T>(
  capability: RepoWriteExecutionCapability,
  task: (source: RepoSource) => Promise<T>,
): Promise<T> {
  return await task(repoWriteExecutionState(capability).source)
}

export async function validateRepoWriteExecution(
  capability: RepoWriteExecutionCapability,
  signal?: AbortSignal,
): Promise<boolean> {
  return await repoWriteExecutionState(capability).validate(signal)
}

function repoWriteExecutionState(capability: RepoWriteExecutionCapability): RepoWriteExecutionState {
  const state = repoWriteExecutions.get(capability)
  if (!state) throw new Error('error.invalid-repository-write-capability')
  return state
}

function serverWorkspaceLocatorPlatform(): WorkspaceLocatorPlatform {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

function repoWriteBoundaryCoordinationKey(boundary: RepoWriteBoundary): string {
  switch (boundary.kind) {
    case 'local-git':
      return `local-git:${boundary.commonDir}`
    case 'remote-git':
      return `remote-git:${boundary.executionIdentity}`
  }
  const exhaustive: never = boundary
  return exhaustive
}

function repoWriteBoundaryRepositoryKey(boundary: RepoWriteBoundary): string {
  return JSON.stringify({
    coordinationKey: repoWriteBoundaryCoordinationKey(boundary),
    generationKey: boundary.generationKey,
  })
}

/**
 * Canonical repository identity is mandatory for every boundary-scoped read
 * and write. A workspace locator describes user intent, not a physical
 * repository, so never substitute the locator, a cached group, or a previous
 * identity when resolution fails. Fail before observing state or admitting an
 * operation instead.
 */
async function resolveLocalRepoWriteBoundary(repoId: WorkspaceId, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator || locator.transport !== 'file') throw new Error('error.workspace-locator-malformed')
  return (await resolveLocalRepoExecution(locator.path, signal)).boundary
}

async function resolveLocalRepoWriteBoundaryForPath(
  repoPath: string,
  signal?: AbortSignal,
): Promise<RepoWriteBoundary> {
  return (await resolveLocalRepoExecution(repoPath, signal)).boundary
}

async function resolveLocalRepoExecution(repoPath: string, signal?: AbortSignal): Promise<LocalRepoExecutionSnapshot> {
  try {
    const canonicalRepoPath = await fs.realpath(repoPath)
    signal?.throwIfAborted()
    const commonDir = await resolveRepoCommonDir(canonicalRepoPath, { signal })
    const objectsDir = await resolveRepoObjectsDir(canonicalRepoPath, { signal })
    const commonDirStat = await fs.stat(commonDir, { bigint: true })
    const objectsDirStat = await fs.stat(objectsDir, { bigint: true })
    signal?.throwIfAborted()
    return {
      canonicalRepoPath,
      boundary: {
        kind: 'local-git',
        commonDir,
        generationKey: JSON.stringify({
          commonDirDeviceId: commonDirStat.dev.toString(10),
          commonDirInode: commonDirStat.ino.toString(10),
          objectsDir,
          objectsDirDeviceId: objectsDirStat.dev.toString(10),
          objectsDirInode: objectsDirStat.ino.toString(10),
        }),
      },
    }
  } catch {
    signal?.throwIfAborted()
    throw new RepositoryBoundaryUnavailableError()
  }
}

async function resolveRemoteRepoWriteBoundary(repoId: WorkspaceId, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  return await resolveRepoWriteBoundaryForLocator(repoId, undefined, signal)
}

async function resolveRepoWriteBoundaryForLocator(
  repoId: WorkspaceId,
  runtime?: RepoSourceRuntimeContext,
  signal?: AbortSignal,
): Promise<RepoWriteBoundary> {
  const locator = parseWorkspaceLocator(repoId, serverWorkspaceLocatorPlatform())
  if (!locator) throw new Error('error.workspace-locator-malformed')
  if (locator.transport === 'file') return await resolveLocalRepoWriteBoundary(repoId, signal)
  const target = await resolveRemoteWorkspaceTarget(repoId, runtime, signal)
  return await resolveRemoteRepoWriteBoundaryForTarget(
    target,
    signal,
    runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined,
  )
}

async function resolveRemoteRepoWriteBoundaryForTarget(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
  run?: RemoteGitRunner,
): Promise<RepoWriteBoundary> {
  const identity = await resolveRemoteRepoExecutionIdentity(target, { signal, run })
  signal?.throwIfAborted()
  if (!identity) throw new RepositoryBoundaryUnavailableError()
  const sshOptions = target.sshConnection?.options ?? []
  return {
    kind: 'remote-git',
    executionIdentity: JSON.stringify({
      host: target.host,
      user: target.user,
      port: target.port,
      options: sshOptions,
      ...(sshOptions.some(sshOptionUsesOriginalDestination)
        ? { destination: target.sshConnection?.destination ?? target.alias }
        : {}),
      writeGroupPath: identity.commonDir,
    }),
    generationKey: identity.generationKey,
  }
}

function sshOptionUsesOriginalDestination(option: string): boolean {
  for (let index = 0; index < option.length - 1; index += 1) {
    if (option[index] !== '%') continue
    const token = option[index + 1]
    if (token === '%') {
      index += 1
      continue
    }
    if (token === 'n') return true
  }
  return false
}

export async function resolveRepoWriteBoundaryIdentity(
  repoId: WorkspaceId,
  signal?: AbortSignal,
): Promise<{ coordinationKey: string; repositoryKey: string }> {
  const boundary = isRemoteWorkspaceId(repoId)
    ? await resolveRemoteRepoWriteBoundary(repoId, signal)
    : await resolveLocalRepoWriteBoundary(repoId, signal)
  return {
    coordinationKey: repoWriteBoundaryCoordinationKey(boundary),
    repositoryKey: repoWriteBoundaryRepositoryKey(boundary),
  }
}

function withAffectedRepoIds(result: ExecResult, affectedRepoIds: readonly WorkspaceId[]): RepoMutationResult {
  const unique = Array.from(new Set(affectedRepoIds.filter((repoId) => repoId.length > 0)))
  return unique.length > 0 ? { ...result, affectedRepoIds: unique } : result
}

function localWorktreeRepoIds(worktrees: WorktreeInfo[]): WorkspaceId[] {
  return worktrees.flatMap((worktree) => {
    if (worktree.isBare) return []
    const id = localWorkspaceId(worktree.path)
    return id ? [id] : []
  })
}

function localWorkspaceId(worktreePath: string): WorkspaceId | null {
  const platform = serverWorkspaceLocatorPlatform()
  return formatWorkspaceLocator({ transport: 'file', platform, path: worktreePath }, platform)
}

function remoteWorktreeRepoIds(
  target: RemoteWorkspaceTarget,
  worktreePaths: readonly string[] | undefined,
): WorkspaceId[] {
  if (!worktreePaths) return []
  return worktreePaths.flatMap((remotePath) => {
    const ref = normalizeRemoteWorkspaceRef({ alias: target.alias, remotePath })
    return ref ? [ref.id] : []
  })
}

async function readLocalAffectedRepoIds(repoId: string, signal?: AbortSignal): Promise<WorkspaceId[]> {
  try {
    return localWorktreeRepoIds(await getWorktrees(repoId, { includeStatus: false, signal }))
  } catch {
    return []
  }
}

async function readRemoteAffectedRepoIds(
  target: RemoteWorkspaceTarget,
  signal?: AbortSignal,
  run?: RemoteGitRunner,
): Promise<WorkspaceId[]> {
  try {
    return remoteWorktreeRepoIds(target, await getRemoteRepoWorktreePaths(target, { signal, run }))
  } catch {
    return []
  }
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
  const capabilities: RepoSourceCapabilities = { pullRequests: 'cwd-github' }

  async function validateBranchDeletion(
    branch: string,
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
    const worktrees = knownWorktrees ?? (await getWorktrees(gitCwd, { includeStatus: false, signal }))
    const ignoredPath = ignoredWorktreePath ? path.resolve(ignoredWorktreePath) : null
    const isCheckedOutElsewhere = worktrees.some((wt) => {
      if (wt.branch !== branch) return false
      return ignoredPath ? path.resolve(wt.path) !== ignoredPath : true
    })
    const mergedToCurrent = !options?.force && current ? await isAncestor(gitCwd, branch, current, signal) : false
    const upstream = !options?.force ? await getUpstream(gitCwd, branch, signal) : null
    const mergedToUpstream = !options?.force && upstream ? await isAncestor(gitCwd, branch, upstream, signal) : false
    return validateBranchDeletionPolicy({
      branch,
      currentBranch: current,
      isCheckedOutElsewhere,
      force: options?.force,
      mergedToCurrent,
      mergedToUpstream,
      notMergedMessage: options?.notMergedMessage,
    })
  }

  async function deleteBranchAfterValidation(
    branch: string,
    options?: { force?: boolean; deleteUpstream?: boolean },
    signal?: AbortSignal,
    gitCwd = repoId,
  ): Promise<ExecResult> {
    const upstream = options?.deleteUpstream ? await getUpstream(gitCwd, branch, signal) : null
    const deleted = await deleteBranch(gitCwd, branch, { force: options?.force, signal })
    if (!deleted.ok || !upstream) return deleted
    const slash = upstream.indexOf('/')
    if (slash <= 0) return deleted
    const upstreamDeleted = await deleteUpstreamBranch(
      gitCwd,
      upstream.slice(0, slash),
      upstream.slice(slash + 1),
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
      try {
        const worktrees = await getWorktrees(repoId, { signal })
        if (signal?.aborted) return null
        const branches = await getBranches(repoId, worktrees, { signal })
        if (signal?.aborted) return null
        const current = await getCurrentBranch(repoId, { signal })
        if (signal?.aborted) return null
        const currentHEAD = current ? undefined : await getHeadHash(repoId, { signal })
        if (signal?.aborted) return null
        const remote = await getRemoteInfo(repoId, signal)
        if (signal?.aborted) return null
        return { branches, current, currentHEAD, remote }
      } catch (err) {
        if (signal?.aborted) return null
        throw err
      }
    },
    async getWorkspacePaneTargetIdentities(signal) {
      const worktrees = await getWorktrees(repoId, { includeStatus: false, signal })
      signal?.throwIfAborted()
      return await getBranchWorktreeIdentities(repoId, worktrees, { signal })
    },
    async getStatus(signal) {
      if (!isValidCwd(repoId)) throw new Error('error.invalid-path')
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      return await getWorkingStatus(repoId, { signal })
    },
    async getPullRequests(branches, options) {
      if (!isValidCwd(repoId)) return null
      const branchSet = normalizeRequestedBranches(branches)
      if (branchSet?.size === 0) return []
      if (capabilities.pullRequests !== 'cwd-github') return null
      const prs = await getBranchPullRequests(repoId, branchSet, { mode: options?.mode, signal: options?.signal })
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
      return fetched.ok ? withAffectedRepoIds(fetched, affectedRepoIds) : fetched
    },
    async pull(branch, worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const affectedRepoIds = await readLocalAffectedRepoIds(repoId, signal)
      const pulled = await pullBranch(repoId, branch, worktreePath, signal)
      return pulled.ok ? withAffectedRepoIds(pulled, affectedRepoIds) : pulled
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
      const createdWorkspaceId = localWorkspaceId(input.worktreePath)
      const affectedRepoIds = [
        ...(await readLocalAffectedRepoIds(repoId, signal)),
        ...(createdWorkspaceId ? [createdWorkspaceId] : []),
      ]
      const created = await createWorktree(repoId, input, signal)
      if (!created.ok) return created.repositoryStateChanged ? withAffectedRepoIds(created, affectedRepoIds) : created
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
      const worktrees = await getWorktrees(repoId, { includeStatus: false, signal })
      const validation = await validateBranchDeletion(
        branch,
        { force: options?.force },
        signal,
        undefined,
        repoId,
        worktrees,
      )
      if (validation) return validation
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const deleted = await deleteBranchAfterValidation(branch, options, signal)
      return deleted.ok || deleted.repositoryStateChanged ? withAffectedRepoIds(deleted, affectedRepoIds) : deleted
    },
    async removeWorktree(input, signal, lifecycle) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await getWorktrees(repoId, { signal })
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const mainWorktreePath = worktrees.find((wt) => wt.isPrimary)?.path ?? worktrees[0]?.path ?? ''
      const exactExecution = physicalWorktreeCapability
        ? physicalWorktreeExecutionBinding(physicalWorktreeCapability)
        : null
      const requestedPath = exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : input.worktreePath
      const removable = resolveRemovableWorktree(worktrees, input.branch, requestedPath, mainWorktreePath)
      if (!removable.ok) return { ok: false, message: removable.message }
      const mutationCwd =
        path.resolve(removable.target.path) === path.resolve(repoId) && mainWorktreePath ? mainWorktreePath : repoId
      const invalid = validateRemovableWorktreeState(removable.target)
      if (invalid) return invalid
      if (input.deleteBranch) {
        const validation = await validateBranchDeletion(
          input.branch,
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
      if (physicalWorktreeCapability) {
        try {
          await validatePhysicalWorktreeExecution(physicalWorktreeCapability, signal)
          const currentPath = await fs.realpath(removable.target.path)
          const currentStat = await fs.stat(currentPath, { bigint: true })
          if (
            exactExecution?.kind !== 'local' ||
            currentPath !== exactExecution.canonicalWorktreePath ||
            currentStat.dev.toString(10) !== exactExecution.endpointMarker.deviceId ||
            currentStat.ino.toString(10) !== exactExecution.endpointMarker.inode
          )
            throw new Error('error.workspace-runtime-stale')
        } catch (error) {
          await lifecycle.afterRemoveFailed()
          return { ok: false, message: error instanceof Error ? error.message : 'error.workspace-runtime-stale' }
        }
      }
      let removed: Awaited<ReturnType<typeof removeWorktree>>
      try {
        removed = await removeWorktree(
          mutationCwd,
          exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : removable.target.path,
          signal,
        )
      } catch (error) {
        await lifecycle.afterRemoveFailed()
        throw error
      }
      if (!removed.ok) {
        await lifecycle.afterRemoveFailed()
        return removed
      }
      const finalized = await lifecycle.afterWorktreeRemoved()
      if (!finalized.ok) return withAffectedRepoIds({ ...finalized, repositoryStateChanged: true }, affectedRepoIds)
      if (!input.deleteBranch) return withAffectedRepoIds(removed, affectedRepoIds)
      const deleted = await deleteBranchAfterValidation(
        input.branch,
        { force: input.forceDeleteBranch, deleteUpstream: input.deleteUpstream },
        signal,
        mutationCwd,
      )
      return withAffectedRepoIds(deleted.ok ? deleted : { ...deleted, repositoryStateChanged: true }, affectedRepoIds)
    },
    async getPatch(worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await getWorktrees(repoId, { includeStatus: false, signal })
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
): Promise<RepoSource> {
  const target = capturedTarget ?? (await resolveRemoteWorkspaceTarget(repoId, runtime))
  const capabilities: RepoSourceCapabilities = { pullRequests: 'derived-github-repo' }
  const run = runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.workspaceRuntimeId, target) : undefined
  return {
    id: repoId,
    kind: 'remote',
    async getSnapshot(signal) {
      const remoteSnapshot = await getRemoteSnapshot(target, { signal, run })
      if (signal?.aborted || !remoteSnapshot) return null
      return { branches: remoteSnapshot.branches, current: remoteSnapshot.current, remote: remoteSnapshot.remote }
    },
    async getWorkspacePaneTargetIdentities(signal) {
      return await getRemoteWorkspacePaneTargetIdentities(target, { signal, run })
    },
    async getStatus(signal) {
      return await getRemoteStatus(target, { signal, run })
    },
    async getPullRequests(branches, options) {
      const branchSet = normalizeRequestedBranches(branches)
      if (branchSet?.size === 0) return []
      if (capabilities.pullRequests !== 'derived-github-repo') return null
      const repo = await remotePullRequestRepoRef(target, { signal: options?.signal, run })
      if (!repo) return null
      const prs = await getBranchPullRequestsForRepoRef(repoId, repo, branchSet, {
        mode: options?.mode,
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
      return fetched.ok ? withAffectedRepoIds(fetched, affectedRepoIds) : fetched
    },
    async pull(branch, worktreePath, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const pulled = await pullRemoteBranch(target, branch, worktreePath, { signal, run })
      return pulled.ok ? withAffectedRepoIds(pulled, affectedRepoIds) : pulled
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
      const existingRepoIds = await readRemoteAffectedRepoIds(target, signal, run)
      const created = await createRemoteWorktree(target, { ...input, signal, run })
      const affectedRepoIds = [...existingRepoIds, ...remoteWorktreeRepoIds(target, created.affectedWorktreePaths)]
      if (!created.ok) return created.repositoryStateChanged ? withAffectedRepoIds(created, affectedRepoIds) : created
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
      return deleted.ok || deleted.repositoryStateChanged ? withAffectedRepoIds(deleted, affectedRepoIds) : deleted
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
        afterRemoveFailed: lifecycle.afterRemoveFailed,
        validateBeforeRemove: physicalWorktreeCapability
          ? async () => {
              try {
                await validatePhysicalWorktreeExecution(physicalWorktreeCapability, signal)
                return { ok: true, message: '' }
              } catch (error) {
                if (isRemoteWorkspaceRuntimeFailure(error)) throw error
                return { ok: false, message: error instanceof Error ? error.message : 'error.workspace-runtime-stale' }
              }
            }
          : undefined,
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

export function remoteRuntimeAwareGitRunner(
  repoRoot: string,
  workspaceRuntimeId: string,
  sourceTarget: RemoteWorkspaceTarget,
): RemoteGitRunner {
  return async (command, target, options) => {
    const result = await runRemoteCommand(target, command, options)
    const failure = remoteWorkspaceRuntimeFailureFromCommandResult({
      workspaceId: repoRoot,
      workspaceRuntimeId,
      target: sourceTarget,
      result,
    })
    if (failure) throw failure
    return result
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

async function remotePullRequestRepoRef(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<GitHubRepoRef | null> {
  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run: options.run })
  if (!snapshot?.remote?.hasGitHubRemote) return null
  return preferredGitHubRepoRef(snapshot.remote.remotes)
}
