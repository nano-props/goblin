import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import { checkGitAvailable } from '#/system/git/git-exec.ts'
import {
  deleteBranch,
  deleteUpstreamBranch,
  getBranches,
  getCurrentBranch,
  getRepoCommonDir,
  getHeadHash,
  getLog as getBranchLog,
  getRepoName,
  getRepoRoot,
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
import { testRemoteRepo } from '#/system/ssh/diagnostics.ts'
import { SSH_BOOT_PROBE_TIMEOUT_MS } from '#/system/ssh/commands.ts'
import {
  bootstrapRemoteWorktreeAfterCreate,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepo,
  getRemoteBrowserUrl,
  getRemoteLog,
  getRemotePatch,
  getRemoteRepoWorktreePaths,
  getRemoteRepoWriteGroupPath,
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
  isRemoteRepoId,
  parseRemoteRepoId,
  type ProbeResult,
  type PullRequestEntry,
  type RemoteRepoTarget,
  type RepoSnapshot,
} from '#/shared/api-types.ts'
import { normalizeRemoteRepoRef } from '#/shared/remote-repo.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import { remoteRuntimeFailureFromCommandResult } from '#/server/modules/remote-runtime-failure.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

type RepoWriteBoundary =
  | { kind: 'local-git'; commonDir: string }
  | { kind: 'local-path'; repoPath: string }
  | { kind: 'remote-git'; repoId: string }

export interface RepoMutationResult extends ExecResult {
  /**
   * Repo session ids whose repo snapshot changed even when the final
   * command result is a partial failure after an earlier write succeeded.
   */
  affectedRepoIds?: readonly string[]
}

export interface RepoSource {
  id: string
  kind: 'local' | 'remote'
  probe(): Promise<ProbeResult>
  getSnapshot(signal?: AbortSignal): Promise<RepoSnapshot | null>
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
    options?: { force?: boolean; alsoDeleteUpstream?: boolean },
    signal?: AbortSignal,
  ): Promise<RepoMutationResult>
  removeWorktree(
    input: {
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
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
  repoRuntimeId: string
}

export async function resolveRemoteRepoTarget(repoId: string): Promise<RemoteRepoTarget> {
  const parsed = parseRemoteRepoId(repoId)
  if (!parsed) throw new Error('error.ssh-config-changed')
  return (await resolveSshRemoteTarget(parsed)).target
}

export async function runWithRepoSource<T>(
  cwd: string,
  task: (source: Awaited<ReturnType<typeof resolveRepoSource>>) => Promise<T>,
  runtime?: RepoSourceRuntimeContext,
): Promise<T> {
  return await task(await resolveRepoSource(cwd, runtime))
}

export async function runWithCapturedRepoSource<T>(
  cwd: string,
  physicalWorktreeCapability: import('#/server/worktree-removal/physical-worktree-identity-resolver.ts').PhysicalWorktreeCapability,
  task: (source: Awaited<ReturnType<typeof resolveRepoSource>>) => Promise<T>,
): Promise<T> {
  const { physicalWorktreeCapabilityExecution } = await import(
    '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
  )
  const execution = physicalWorktreeCapabilityExecution(physicalWorktreeCapability)
  return await task(
    execution.kind === 'remote'
      ? await createRemoteRepoSource(cwd, execution.target, physicalWorktreeCapability)
      : createLocalRepoSource(execution.canonicalWorktreePath, physicalWorktreeCapability),
  )
}

export async function resolveRepoSource(repoId: string, runtime?: RepoSourceRuntimeContext): Promise<RepoSource> {
  return isRemoteRepoId(repoId) ? await createRemoteRepoSource(repoId, undefined, null, runtime) : createLocalRepoSource(repoId)
}

function repoWriteBoundaryKey(boundary: RepoWriteBoundary): string {
  switch (boundary.kind) {
    case 'local-git':
      return `local-git:${boundary.commonDir}`
    case 'local-path':
      return `local-path:${boundary.repoPath}`
    case 'remote-git':
      return `remote-git:${boundary.repoId}`
  }
  const exhaustive: never = boundary
  return exhaustive
}

async function resolveLocalRepoWriteBoundary(repoId: string, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  const commonDir = await getRepoCommonDir(repoId, { signal })
  return commonDir ? { kind: 'local-git', commonDir } : { kind: 'local-path', repoPath: path.resolve(repoId) }
}

async function resolveRemoteRepoWriteBoundary(repoId: string, signal?: AbortSignal): Promise<RepoWriteBoundary> {
  try {
    const target = await resolveRemoteRepoTarget(repoId)
    const writeGroupPath = await getRemoteRepoWriteGroupPath(target, { signal })
    signal?.throwIfAborted()
    const writeGroupRef = writeGroupPath ? normalizeRemoteRepoRef({ ...target, remotePath: writeGroupPath }) : null
    return { kind: 'remote-git', repoId: writeGroupRef?.id ?? repoId }
  } catch {
    signal?.throwIfAborted()
    return { kind: 'remote-git', repoId }
  }
}

export async function resolveRepoWriteBoundaryKey(repoId: string, signal?: AbortSignal): Promise<string> {
  return repoWriteBoundaryKey(
    isRemoteRepoId(repoId)
      ? await resolveRemoteRepoWriteBoundary(repoId, signal)
      : await resolveLocalRepoWriteBoundary(repoId, signal),
  )
}

function withAffectedRepoIds(result: ExecResult, affectedRepoIds: readonly string[]): RepoMutationResult {
  const unique = Array.from(new Set(affectedRepoIds.filter((repoId) => repoId.length > 0)))
  return unique.length > 0 ? { ...result, affectedRepoIds: unique } : result
}

function localWorktreeRepoIds(worktrees: WorktreeInfo[]): string[] {
  return worktrees.filter((worktree) => !worktree.isBare).map((worktree) => worktree.path)
}

function remoteWorktreeRepoIds(target: RemoteRepoTarget, worktreePaths: readonly string[] | undefined): string[] {
  if (!worktreePaths) return []
  return worktreePaths.flatMap((remotePath) => {
    const ref = normalizeRemoteRepoRef({ alias: target.alias, remotePath })
    return ref ? [ref.id] : []
  })
}

async function readLocalAffectedRepoIds(repoId: string, signal?: AbortSignal): Promise<string[]> {
  try {
    return localWorktreeRepoIds(await getWorktrees(repoId, { includeStatus: false, signal }))
  } catch {
    return []
  }
}

async function readRemoteAffectedRepoIds(target: RemoteRepoTarget, signal?: AbortSignal): Promise<string[]> {
  try {
    return remoteWorktreeRepoIds(target, await getRemoteRepoWorktreePaths(target, { signal }))
  } catch {
    return []
  }
}

async function probeReadableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const { constants: fsConstants, promises: fs } = await import('node:fs')
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
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
  return { ok: false, message: 'error.not-git-repo' }
}

function createLocalRepoSource(
  repoId: string,
  physicalWorktreeCapability: import('#/server/worktree-removal/physical-worktree-identity-resolver.ts').PhysicalWorktreeCapability | null = null,
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
    options?: { force?: boolean; alsoDeleteUpstream?: boolean },
    signal?: AbortSignal,
    gitCwd = repoId,
  ): Promise<ExecResult> {
    const upstream = options?.alsoDeleteUpstream ? await getUpstream(gitCwd, branch, signal) : null
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
    return upstreamDeleted.ok ? upstreamDeleted : { ...upstreamDeleted, repoChanged: true }
  }

  return {
    id: repoId,
    kind: 'local',
    async probe() {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-path' }
      const gitAvailable = await checkGitAvailable()
      if (!gitAvailable.ok) return gitAvailable
      const readable = await probeReadableDirectory(repoId)
      if (!readable.ok) return readable
      const ok = await isGitRepo(repoId)
      if (!ok) return { ok: false, message: 'error.not-git-repo' }
      const root = await getRepoRoot(repoId)
      if (!root) return { ok: false, message: 'error.failed-read-repo' }
      const name = await getRepoName(repoId)
      return { ok: true, root, name }
    },
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
    async getStatus(signal) {
      if (!isValidCwd(repoId)) return []
      const available = await probeGitRepo(repoId)
      if (!available.ok) throw new Error(available.message)
      const status = await getWorkingStatus(repoId, { signal })
      return signal?.aborted ? [] : status
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
      const affectedRepoIds = [...(await readLocalAffectedRepoIds(repoId, signal)), input.worktreePath]
      const created = await createWorktree(repoId, input, signal)
      if (!created.ok) return created.repoChanged ? withAffectedRepoIds(created, affectedRepoIds) : created
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
        : { ...bootstrapped, repoChanged: true }
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
      return deleted.ok || deleted.repoChanged ? withAffectedRepoIds(deleted, affectedRepoIds) : deleted
    },
    async removeWorktree(input, signal, lifecycle) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await getWorktrees(repoId, { signal })
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const mainWorktreePath = worktrees.find((wt) => wt.isPrimary)?.path ?? worktrees[0]?.path ?? ''
      const exactExecution = physicalWorktreeCapability
        ? (await import('#/server/worktree-removal/physical-worktree-identity-resolver.ts')).physicalWorktreeCapabilityExecution(
            physicalWorktreeCapability,
          )
        : null
      const requestedPath = exactExecution?.kind === 'local' ? exactExecution.canonicalWorktreePath : input.worktreePath
      const removable = resolveRemovableWorktree(worktrees, input.branch, requestedPath, mainWorktreePath)
      if (!removable.ok) return { ok: false, message: removable.message }
      const mutationCwd =
        path.resolve(removable.target.path) === path.resolve(repoId) && mainWorktreePath ? mainWorktreePath : repoId
      const invalid = validateRemovableWorktreeState(removable.target)
      if (invalid) return invalid
      if (input.alsoDeleteBranch) {
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
          const { validatePhysicalWorktreeCapabilityExecution } = await import(
            '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
          )
          await validatePhysicalWorktreeCapabilityExecution(physicalWorktreeCapability, signal)
          const currentPath = await realpath(removable.target.path)
          const currentStat = await stat(currentPath, { bigint: true })
          if (
            exactExecution?.kind !== 'local' ||
            currentPath !== exactExecution.canonicalWorktreePath ||
            currentStat.dev.toString(10) !== exactExecution.endpointMarker.deviceId ||
            currentStat.ino.toString(10) !== exactExecution.endpointMarker.inode
          ) throw new Error('error.repo-runtime-stale')
        } catch (error) {
          await lifecycle.afterRemoveFailed()
          return { ok: false, message: error instanceof Error ? error.message : 'error.repo-runtime-stale' }
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
      if (!finalized.ok) return withAffectedRepoIds({ ...finalized, repoChanged: true }, affectedRepoIds)
      if (!input.alsoDeleteBranch) return withAffectedRepoIds(removed, affectedRepoIds)
      const deleted = await deleteBranchAfterValidation(
        input.branch,
        { force: input.forceDeleteBranch, alsoDeleteUpstream: input.alsoDeleteUpstream },
        signal,
        mutationCwd,
      )
      return withAffectedRepoIds(deleted.ok ? deleted : { ...deleted, repoChanged: true }, affectedRepoIds)
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
  capturedTarget?: RemoteRepoTarget,
  physicalWorktreeCapability: import('#/server/worktree-removal/physical-worktree-identity-resolver.ts').PhysicalWorktreeCapability | null = null,
  runtime?: RepoSourceRuntimeContext,
): Promise<RepoSource> {
  const target = capturedTarget ?? (await resolveRemoteRepoTarget(repoId))
  const capabilities: RepoSourceCapabilities = { pullRequests: 'derived-github-repo' }
  const run = runtime ? remoteRuntimeAwareGitRunner(repoId, runtime.repoRuntimeId, target) : undefined
  return {
    id: repoId,
    kind: 'remote',
    async probe() {
      const result = await testRemoteRepo(target, { timeoutMs: SSH_BOOT_PROBE_TIMEOUT_MS })
      if (!result.ok) return { ok: false, message: result.message || 'error.failed-read-repo' }
      return { ok: true, root: target.id, name: target.displayName }
    },
    async getSnapshot(signal) {
      const remoteSnapshot = await getRemoteSnapshot(target, { signal, run })
      if (signal?.aborted || !remoteSnapshot) return null
      return { branches: remoteSnapshot.branches, current: remoteSnapshot.current, remote: remoteSnapshot.remote }
    },
    async getStatus(signal) {
      const status = await getRemoteStatus(target, { signal, run })
      return signal?.aborted ? [] : status
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
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal)
      const fetched = await fetchRemoteRepo(target, { signal })
      return fetched.ok ? withAffectedRepoIds(fetched, affectedRepoIds) : fetched
    },
    async pull(branch, worktreePath, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal)
      const pulled = await pullRemoteBranch(target, branch, worktreePath, { signal })
      return pulled.ok ? withAffectedRepoIds(pulled, affectedRepoIds) : pulled
    },
    async push(branch, signal) {
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal)
      const pushed = await pushRemoteBranch(target, branch, { signal })
      return pushed.ok ? withAffectedRepoIds(pushed, affectedRepoIds) : pushed
    },
    async getWorktreeBootstrapPreview(signal) {
      return await getRemoteWorktreeBootstrapPreview(target, { signal })
    },
    async createWorktree(input, signal, options) {
      const existingRepoIds = await readRemoteAffectedRepoIds(target, signal)
      const created = await createRemoteWorktree(target, { ...input, signal })
      const affectedRepoIds = [...existingRepoIds, ...remoteWorktreeRepoIds(target, created.affectedWorktreePaths)]
      if (!created.ok) return created.repoChanged ? withAffectedRepoIds(created, affectedRepoIds) : created
      if (options?.worktreeBootstrap?.kind !== 'run') return withAffectedRepoIds(created, affectedRepoIds)
      const bootstrapped = await bootstrapRemoteWorktreeAfterCreate(target, input.worktreePath, {
        signal,
        expectedConfigHash: options.worktreeBootstrap.configHash,
      })
      if (!bootstrapped.ok) return withAffectedRepoIds({ ...bootstrapped, repoChanged: true }, affectedRepoIds)
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
      const affectedRepoIds = await readRemoteAffectedRepoIds(target, signal)
      const deleted = await deleteRemoteBranch(target, {
        branch,
        force: options?.force,
        alsoDeleteUpstream: options?.alsoDeleteUpstream,
        signal,
      })
      return deleted.ok || deleted.repoChanged ? withAffectedRepoIds(deleted, affectedRepoIds) : deleted
    },
    async removeWorktree(input, signal, lifecycle) {
      const exactExecution = physicalWorktreeCapability
        ? (await import('#/server/worktree-removal/physical-worktree-identity-resolver.ts')).physicalWorktreeCapabilityExecution(
            physicalWorktreeCapability,
          )
        : null
      const result = await removeRemoteWorktree(target, {
        ...input,
        worktreePath: exactExecution?.kind === 'remote' ? exactExecution.canonicalWorktreePath : input.worktreePath,
        signal,
        beforeRemove: lifecycle.beforeRemove,
        afterWorktreeRemoved: lifecycle.afterWorktreeRemoved,
        afterRemoveFailed: lifecycle.afterRemoveFailed,
        validateBeforeRemove: physicalWorktreeCapability
          ? async () => {
              try {
                const { validatePhysicalWorktreeCapabilityExecution } = await import(
                  '#/server/worktree-removal/physical-worktree-identity-resolver.ts'
                )
                await validatePhysicalWorktreeCapabilityExecution(physicalWorktreeCapability, signal)
                return { ok: true, message: '' }
              } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : 'error.repo-runtime-stale' }
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

function remoteRuntimeAwareGitRunner(
  repoRoot: string,
  repoRuntimeId: string,
  sourceTarget: RemoteRepoTarget,
): RemoteGitRunner {
  return async (command, target, options) => {
    const result = await runRemoteCommand(target, command, options)
    const failure = remoteRuntimeFailureFromCommandResult({
      repoRoot,
      repoRuntimeId,
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
  target: RemoteRepoTarget,
  options: { signal?: AbortSignal; run?: RemoteGitRunner } = {},
): Promise<GitHubRepoRef | null> {
  const snapshot = await getRemoteSnapshot(target, { signal: options.signal, run: options.run })
  if (!snapshot?.remote?.hasGitHubRemote) return null
  return preferredGitHubRepoRef(snapshot.remote.remotes)
}
