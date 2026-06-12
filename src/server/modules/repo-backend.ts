import path from 'node:path'
import { checkGitAvailable } from '#/system/git/helper.ts'
import {
  checkoutBranch,
  deleteBranch,
  deleteUpstreamBranch,
  getBranches,
  getCurrentBranch,
  getDefaultBranch,
  getRepoName,
  getRepoRoot,
  getUpstream,
  isAncestor,
  isGitRepo,
} from '#/system/git/branches.ts'
import {
  fetchAll,
  getBrowserRemoteUrl,
  getRemoteInfo,
  pickPreferredRemote,
  pullBranch,
  pushBranch,
} from '#/system/git/remote.ts'
import { getWorkingStatus } from '#/system/git/status.ts'
import { createWorktree, getWorktrees, removeWorktree } from '#/system/git/worktrees.ts'
import { getWorktreePatch } from '#/system/git/patch.ts'
import {
  type ExecResult,
  type PullRequestFetchMode,
  type PullRequestInfo,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'
import { isValidCwd } from '#/shared/input-validation.ts'
import {
  validateBranchDeletionPolicy,
  validateCreateWorktreeInput,
  validateRemovableWorktreeState,
} from '#/shared/repo-action-policy.ts'
import { resolveRemoteTarget as resolveSshRemoteTarget } from '#/system/ssh/config.ts'
import { testRemoteRepository } from '#/system/ssh/diagnostics.ts'
import {
  checkoutRemoteBranch,
  createRemoteWorktree,
  deleteRemoteBranch,
  fetchRemoteRepository,
  getRemoteBrowserUrl,
  getRemotePatch,
  getRemoteSnapshot,
  getRemoteStatus,
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
} from '#/shared/rpc.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

export interface RepoBackend {
  id: string
  kind: 'local' | 'remote'
  probe(): Promise<ProbeResult>
  getSnapshot(signal?: AbortSignal): Promise<RepoSnapshot | null>
  getStatus(signal?: AbortSignal): Promise<WorktreeStatus[]>
  getPullRequests(
    branches?: string[],
    options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
  ): Promise<PullRequestEntry[] | null>
  fetch(signal: AbortSignal): Promise<{ ok: boolean; message: string }>
  checkout(branch: string, signal?: AbortSignal): Promise<ExecResult>
  pull(branch: string, worktreePath?: string, signal?: AbortSignal): Promise<ExecResult>
  push(branch: string, signal?: AbortSignal): Promise<ExecResult>
  createWorktree(worktreePath: string, newBranch: string, baseBranch: string, signal?: AbortSignal): Promise<ExecResult>
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
  ): Promise<ExecResult>
  getPatch(worktreePath: string, signal?: AbortSignal): Promise<ExecResult>
  getBrowserRemoteUrl(branch?: string, signal?: AbortSignal): Promise<string | null>
}

interface RepoBackendCapabilities {
  pullRequests: 'cwd-github' | 'derived-github-repo'
}

export async function resolveRemoteRepoTarget(repoId: string): Promise<RemoteRepoTarget> {
  const parsed = parseRemoteRepoId(repoId)
  if (!parsed) throw new Error('error.ssh-config-changed')
  return (await resolveSshRemoteTarget(parsed)).target
}

export async function runWithRepoBackend<T>(
  cwd: string,
  task: (backend: Awaited<ReturnType<typeof resolveRepoBackend>>) => Promise<T>,
): Promise<T> {
  return await task(await resolveRepoBackend(cwd))
}

export async function resolveRepoBackend(repoId: string): Promise<RepoBackend> {
  return isRemoteRepoId(repoId) ? await createRemoteRepoBackend(repoId) : createLocalRepoBackend(repoId)
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

async function probeGitRepository(cwd: string): Promise<ProbeAvailability> {
  const ok = await isGitRepo(cwd)
  if (ok) return { ok: true }
  const readable = await probeReadableDirectory(cwd)
  if (!readable.ok) return readable
  return { ok: false, message: 'error.not-git-repo' }
}

function createLocalRepoBackend(repoId: string): RepoBackend {
  const capabilities: RepoBackendCapabilities = { pullRequests: 'cwd-github' }

  async function validateBranchDeletion(
    branch: string,
    options?: {
      force?: boolean
      notMergedMessage?: 'error.branch-not-fully-merged' | 'error.cannot-remove-unpushed-worktree'
    },
    signal?: AbortSignal,
    ignoredWorktreePath?: string,
  ): Promise<ExecResult | null> {
    const current = await getCurrentBranch(repoId, { signal })
    const worktrees = await getWorktrees(repoId, { includeStatus: false, signal })
    const ignoredPath = ignoredWorktreePath ? path.resolve(ignoredWorktreePath) : null
    const isCheckedOutElsewhere = worktrees.some((wt) => {
      if (wt.branch !== branch) return false
      return ignoredPath ? path.resolve(wt.path) !== ignoredPath : true
    })
    const mergedToCurrent = !options?.force && current ? await isAncestor(repoId, branch, current, signal) : false
    const upstream = !options?.force ? await getUpstream(repoId, branch, signal) : null
    const mergedToUpstream = !options?.force && upstream ? await isAncestor(repoId, branch, upstream, signal) : false
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
  ): Promise<ExecResult> {
    const upstream = options?.alsoDeleteUpstream ? await getUpstream(repoId, branch, signal) : null
    const deleted = await deleteBranch(repoId, branch, { force: options?.force, signal })
    if (!deleted.ok || !upstream) return deleted
    const slash = upstream.indexOf('/')
    if (slash <= 0) return deleted
    return await deleteUpstreamBranch(repoId, upstream.slice(0, slash), upstream.slice(slash + 1), signal)
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
      const available = await probeGitRepository(repoId)
      if (!available.ok) throw new Error(available.message)
      try {
        const worktrees = await getWorktrees(repoId, { signal })
        if (signal?.aborted) return null
        const branches = await getBranches(repoId, worktrees, { signal })
        if (signal?.aborted) return null
        const current = await getCurrentBranch(repoId, { signal })
        if (signal?.aborted) return null
        const remote = await getRemoteInfo(repoId, signal)
        if (signal?.aborted) return null
        return { branches, current, remote }
      } catch (err) {
        if (signal?.aborted) return null
        throw err
      }
    },
    async getStatus(signal) {
      if (!isValidCwd(repoId)) return []
      const available = await probeGitRepository(repoId)
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
    async fetch(signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const available = await probeGitRepository(repoId)
      if (!available.ok) return available
      return await fetchAll(repoId, signal)
    },
    async checkout(branch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await checkoutBranch(repoId, branch, signal)
    },
    async pull(branch, worktreePath, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await pullBranch(repoId, branch, worktreePath, signal)
    },
    async push(branch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      return await pushBranch(repoId, branch, signal)
    },
    async createWorktree(worktreePath, newBranch, baseBranch, signal) {
      if (!isValidCwd(repoId)) return { ok: false, message: 'error.invalid-arguments' }
      const invalid = validateCreateWorktreeInput(worktreePath, newBranch, baseBranch)
      if (invalid) return invalid
      return await createWorktree(repoId, worktreePath, newBranch, baseBranch, signal)
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
      const removable = resolveRemovableWorktree(worktrees, input.branch, input.worktreePath, repoId)
      if (!removable.ok) return { ok: false, message: removable.message }
      const invalid = validateRemovableWorktreeState(removable.target)
      if (invalid) return invalid
      if (input.alsoDeleteBranch) {
        const validation = await validateBranchDeletion(
          input.branch,
          { force: input.forceDeleteBranch, notMergedMessage: 'error.cannot-remove-unpushed-worktree' },
          signal,
          removable.target.path,
        )
        if (validation) return validation
      }
      const removed = await removeWorktree(repoId, removable.target.path, signal)
      if (!removed.ok || !input.alsoDeleteBranch) return removed
      return await deleteBranchAfterValidation(
        input.branch,
        { force: input.forceDeleteBranch, alsoDeleteUpstream: input.alsoDeleteUpstream },
        signal,
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
    async getBrowserRemoteUrl(branch, signal) {
      return await getBrowserRemoteUrl(repoId, { branch, signal })
    },
  }
}

async function createRemoteRepoBackend(repoId: string): Promise<RepoBackend> {
  const target = await resolveRemoteRepoTarget(repoId)
  const capabilities: RepoBackendCapabilities = { pullRequests: 'derived-github-repo' }
  return {
    id: repoId,
    kind: 'remote',
    async probe() {
      const result = await testRemoteRepository(target)
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
    async fetch(signal) {
      return await fetchRemoteRepository(target, { signal })
    },
    async checkout(branch, signal) {
      return await checkoutRemoteBranch(target, branch, undefined, { signal })
    },
    async pull(branch, worktreePath, signal) {
      return await pullRemoteBranch(target, branch, worktreePath, { signal })
    },
    async push(branch, signal) {
      return await pushRemoteBranch(target, branch, { signal })
    },
    async createWorktree(worktreePath, newBranch, baseBranch, signal) {
      return await createRemoteWorktree(target, { worktreePath, newBranch, baseBranch, signal })
    },
    async deleteBranch(branch, options, signal) {
      return await deleteRemoteBranch(target, { branch, force: options?.force, signal })
    },
    async removeWorktree(input, signal) {
      return await removeRemoteWorktree(target, { ...input, signal })
    },
    async getPatch(worktreePath, signal) {
      return await getRemotePatch(target, worktreePath, { signal })
    },
    async getBrowserRemoteUrl(branch, signal) {
      return await getRemoteBrowserUrl(target, branch, { signal })
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
