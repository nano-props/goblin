import path from 'node:path'
import { checkGitAvailable } from '#/system/git/git-exec.ts'
import {
  deleteBranch,
  deleteUpstreamBranch,
  getBranches,
  getCurrentBranch,
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
  getRemoteSnapshot,
  getRemoteStatus,
  getRemoteWorktreeBootstrapPreview,
  getRemoteTrackingBranches as getSshRemoteTrackingBranches,
  pullRemoteBranch,
  pushRemoteBranch,
  removeRemoteWorktree,
} from '#/system/ssh/git.ts'
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

type ProbeAvailability = { ok: true } | { ok: false; message: string }

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
  fetch(signal: AbortSignal): Promise<{ ok: boolean; message: string }>
  pull(branch: string, worktreePath?: string, signal?: AbortSignal): Promise<ExecResult>
  push(branch: string, signal?: AbortSignal): Promise<ExecResult>
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
  ): Promise<ExecResult>
  removeWorktree(
    input: {
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
    },
    signal?: AbortSignal,
  ): Promise<RepoMutationResult>
  getPatch(worktreePath: string, signal?: AbortSignal): Promise<ExecResult>
  getBrowserRepoUrl(target: RepoUrlTarget, signal?: AbortSignal): Promise<string | null>
}

interface RepoSourceCapabilities {
  pullRequests: 'cwd-github' | 'derived-github-repo'
}

export async function resolveRemoteRepoTarget(repoId: string): Promise<RemoteRepoTarget> {
  const parsed = parseRemoteRepoId(repoId)
  if (!parsed) throw new Error('error.ssh-config-changed')
  return (await resolveSshRemoteTarget(parsed)).target
}

export async function runWithRepoSource<T>(
  cwd: string,
  task: (source: Awaited<ReturnType<typeof resolveRepoSource>>) => Promise<T>,
): Promise<T> {
  return await task(await resolveRepoSource(cwd))
}

export async function resolveRepoSource(repoId: string): Promise<RepoSource> {
  return isRemoteRepoId(repoId) ? await createRemoteRepoSource(repoId) : createLocalRepoSource(repoId)
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

function createLocalRepoSource(repoId: string): RepoSource {
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
  ): Promise<ExecResult | null> {
    const current = await getCurrentBranch(gitCwd, { signal })
    const worktrees = await getWorktrees(gitCwd, { includeStatus: false, signal })
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
    return await deleteUpstreamBranch(gitCwd, upstream.slice(0, slash), upstream.slice(slash + 1), signal)
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
      return await fetchAll(repoId, signal)
    },
    async pull(branch, worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await pullBranch(repoId, branch, worktreePath, signal)
    },
    async push(branch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await pushBranch(repoId, branch, signal)
    },
    async getWorktreeBootstrapPreview(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await getLocalWorktreeBootstrapPreview(repoId, { signal })
    },
    async createWorktree(input, signal, options) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const created = await createWorktree(repoId, input, signal)
      if (!created.ok) return created
      if (options?.worktreeBootstrap?.kind !== 'run') return withAffectedRepoIds(created, [input.worktreePath])
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
      return withAffectedRepoIds(result, [input.worktreePath])
    },
    async deleteBranch(branch, options, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const validation = await validateBranchDeletion(branch, { force: options?.force }, signal)
      if (validation) return validation
      return await deleteBranchAfterValidation(branch, options, signal)
    },
    async removeWorktree(input, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const worktrees = await getWorktrees(repoId, { signal })
      const affectedRepoIds = localWorktreeRepoIds(worktrees)
      const mainWorktreePath = worktrees.find((wt) => wt.isPrimary)?.path ?? worktrees[0]?.path ?? ''
      const removable = resolveRemovableWorktree(worktrees, input.branch, input.worktreePath, mainWorktreePath)
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
        )
        if (validation) return validation
      }
      const removed = await removeWorktree(mutationCwd, removable.target.path, signal)
      if (!removed.ok) return removed
      if (!input.alsoDeleteBranch) return withAffectedRepoIds(removed, affectedRepoIds)
      return withAffectedRepoIds(
        await deleteBranchAfterValidation(
          input.branch,
          { force: input.forceDeleteBranch, alsoDeleteUpstream: input.alsoDeleteUpstream },
          signal,
          mutationCwd,
        ),
        affectedRepoIds,
      )
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

async function createRemoteRepoSource(repoId: string): Promise<RepoSource> {
  const target = await resolveRemoteRepoTarget(repoId)
  const capabilities: RepoSourceCapabilities = { pullRequests: 'derived-github-repo' }
  return {
    id: repoId,
    kind: 'remote',
    async probe() {
      const result = await testRemoteRepo(target, { timeoutMs: SSH_BOOT_PROBE_TIMEOUT_MS })
      if (!result.ok) return { ok: false, message: result.message || 'error.failed-read-repo' }
      return { ok: true, root: target.id, name: target.displayName }
    },
    async getSnapshot(signal) {
      const remoteSnapshot = await getRemoteSnapshot(target, { signal })
      if (signal?.aborted || !remoteSnapshot) return null
      return { branches: remoteSnapshot.branches, current: remoteSnapshot.current, remote: remoteSnapshot.remote }
    },
    async getStatus(signal) {
      const status = await getRemoteStatus(target, { signal })
      return signal?.aborted ? [] : status
    },
    async getPullRequests(branches, options) {
      const branchSet = normalizeRequestedBranches(branches)
      if (branchSet?.size === 0) return []
      if (capabilities.pullRequests !== 'derived-github-repo') return null
      const repo = await remotePullRequestRepoRef(target, options?.signal)
      if (!repo) return null
      const prs = await getBranchPullRequestsForRepoRef(repoId, repo, branchSet, {
        mode: options?.mode,
        signal: options?.signal,
      })
      return pullRequestEntries(prs)
    },
    async getLog(branch, options) {
      return await getRemoteLog(target, branch, options?.count, options?.skip, { signal: options?.signal })
    },
    async getRemoteBranches(signal) {
      return await getSshRemoteTrackingBranches(target, { signal })
    },
    async fetch(signal) {
      return await fetchRemoteRepo(target, { signal })
    },
    async pull(branch, worktreePath, signal) {
      return await pullRemoteBranch(target, branch, worktreePath, { signal })
    },
    async push(branch, signal) {
      return await pushRemoteBranch(target, branch, { signal })
    },
    async getWorktreeBootstrapPreview(signal) {
      return await getRemoteWorktreeBootstrapPreview(target, { signal })
    },
    async createWorktree(input, signal, options) {
      const created = await createRemoteWorktree(target, { ...input, signal })
      const affectedRepoIds = remoteWorktreeRepoIds(target, created.affectedWorktreePaths)
      if (!created.ok) return withAffectedRepoIds(created, affectedRepoIds)
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
      return await deleteRemoteBranch(target, { branch, force: options?.force, signal })
    },
    async removeWorktree(input, signal) {
      const result = await removeRemoteWorktree(target, { ...input, signal })
      return withAffectedRepoIds(result, remoteWorktreeRepoIds(target, result.affectedWorktreePaths))
    },
    async getPatch(worktreePath, signal) {
      return await getRemotePatch(target, worktreePath, { signal })
    },
    async getBrowserRepoUrl(urlTarget, signal) {
      return await getRemoteBrowserUrl(target, urlTarget, { signal })
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

async function remotePullRequestRepoRef(target: RemoteRepoTarget, signal?: AbortSignal): Promise<GitHubRepoRef | null> {
  const snapshot = await getRemoteSnapshot(target, { signal })
  if (!snapshot?.remote?.hasGitHubRemote) return null
  return preferredGitHubRepoRef(snapshot.remote.remotes)
}
