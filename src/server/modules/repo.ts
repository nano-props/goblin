import { runServerCancellable, abortServerNetworkOp } from '#/server/common/network-ops.ts'
import { getBackgroundSyncRepos as getRegisteredBackgroundSyncRepos, setBackgroundSyncRepos as setRegisteredBackgroundSyncRepos } from '#/server/modules/background-sync.ts'
import { publishRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  invalidateCachedRepoReadModel,
  readCachedPullRequests,
  readCachedRepoSnapshot,
  writeCachedPullRequests,
  writeCachedRepoSnapshot,
} from '#/server/modules/repo-read-model.ts'
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
import { cloneRepository as cloneGitRepository } from '#/system/git/clone.ts'
import { type ExecResult, type PullRequestFetchMode, type WorktreeStatus } from '#/shared/git-types.ts'
import { checkGitAvailable } from '#/system/git/helper.ts'
import { fetchAll, getBrowserRemoteUrl, getRemoteInfo, pullBranch, pushBranch } from '#/system/git/remote.ts'
import { getWorkingStatus } from '#/system/git/status.ts'
import { createWorktree, getWorktrees, removeWorktree } from '#/system/git/worktrees.ts'
import { getWorktreePatch } from '#/system/git/patch.ts'
import { resolveKnownWorktree, resolveRemovableWorktree } from '#/shared/worktree-guards.ts'
import { isValidCwd, isValidRepoLocator } from '#/shared/input-validation.ts'
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
import { getBranchPullRequests } from '#/system/git/pull-requests.ts'
import { openInPreferredEditor } from '#/system/editors.ts'
import { openInPreferredTerminal } from '#/system/terminals.ts'
import {
  isRemoteRepoId,
  parseRemoteRepoId,
  type CloneRepoResult,
  type NetworkOpKind,
  type ProbeResult,
  type PullRequestEntry,
  type RemoteRepoTarget,
  type RepoSnapshot,
} from '#/shared/rpc.ts'
import { constants as fsConstants, promises as fs } from 'node:fs'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'

type ProbeAvailability = { ok: true } | { ok: false; message: string }

const MAX_CLONE_URL_LENGTH = 4096
const MAX_CLONE_DIR_NAME_LENGTH = 255
const CLONE_URL_SCHEME_RE = /^(?:https?|ssh|git|file):\/\/\S+$/i
const SCP_LIKE_CLONE_URL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+:[^\s]+$/
const CLONE_OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const activeCloneControllers = new Map<string, AbortController>()
const activeBackgroundFetches = new Map<string, Promise<{ ok: boolean; message: string }>>()

async function probeReadableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fsConstants.R_OK)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
}

async function probeWritableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    const stat = await fs.stat(cwd)
    if (!stat.isDirectory()) return { ok: false, message: 'error.path-not-directory' }
    await fs.access(cwd, fsConstants.R_OK | fsConstants.W_OK)
    return { ok: true }
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
}

async function ensureWritableDirectory(cwd: string): Promise<ProbeAvailability> {
  try {
    await fs.mkdir(cwd, { recursive: true })
  } catch (err) {
    return { ok: false, message: classifyPathProbeError(err) }
  }
  return await probeWritableDirectory(cwd)
}

function classifyPathProbeError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOENT') return 'error.path-not-found'
  if (code === 'ENOTDIR') return 'error.path-not-directory'
  if (code === 'EACCES' || code === 'EPERM') return 'error.path-permission-denied'
  return 'error.invalid-path'
}

function isValidCloneUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_URL_LENGTH &&
    !/[\0-\x1f\x7f]/.test(value) &&
    (CLONE_URL_SCHEME_RE.test(value) || SCP_LIKE_CLONE_URL_RE.test(value))
  )
}

function isValidCloneDirectoryName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CLONE_DIR_NAME_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !/[\\/:\0]/.test(value)
  )
}

function isValidCloneOperationId(value: unknown): value is string {
  return typeof value === 'string' && CLONE_OPERATION_ID_RE.test(value)
}

async function resolveRemoteRepoTarget(repoId: string): Promise<RemoteRepoTarget> {
  const parsed = parseRemoteRepoId(repoId)
  if (!parsed) throw new Error('error.ssh-config-changed')
  return (await resolveSshRemoteTarget(parsed)).target
}

export async function probeRepository(cwd: string): Promise<ProbeResult> {
  if (isRemoteRepoId(cwd)) {
    let target: RemoteRepoTarget
    try {
      target = await resolveRemoteRepoTarget(cwd)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
    }
    const result = await testRemoteRepository(target)
    if (!result.ok) return { ok: false, message: result.message || 'error.failed-read-repo' }
    return { ok: true, root: target.id, name: target.displayName }
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-path' }
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable.ok) return gitAvailable
  const readable = await probeReadableDirectory(cwd)
  if (!readable.ok) return readable
  const ok = await isGitRepo(cwd)
  if (!ok) return { ok: false, message: 'error.not-git-repo' }
  const root = await getRepoRoot(cwd)
  if (!root) return { ok: false, message: 'error.failed-read-repo' }
  const name = await getRepoName(cwd)
  return { ok: true, root, name }
}

export async function cloneRepository(
  operationId: string,
  url: string,
  parentPath: string,
  directoryName: string,
): Promise<CloneRepoResult> {
  if (!isValidCloneOperationId(operationId)) return { ok: false, message: 'error.invalid-arguments' }
  const repoUrl = typeof url === 'string' ? url.trim() : ''
  const targetParent = typeof parentPath === 'string' ? parentPath.trim() : ''
  const targetName = typeof directoryName === 'string' ? directoryName.trim() : ''
  if (!isValidCloneUrl(repoUrl) || !isValidCloneDirectoryName(targetName)) {
    return { ok: false, message: 'error.invalid-arguments' }
  }
  if (!isValidCwd(targetParent)) return { ok: false, message: 'error.invalid-path' }
  const gitAvailable = await checkGitAvailable()
  if (!gitAvailable.ok) return gitAvailable
  const writable = await ensureWritableDirectory(targetParent)
  if (!writable.ok) return writable
  if (activeCloneControllers.has(operationId)) return { ok: false, message: 'error.network-op-in-progress' }
  const ctrl = new AbortController()
  activeCloneControllers.set(operationId, ctrl)
  try {
    return await cloneGitRepository(targetParent, targetName, repoUrl, ctrl.signal)
  } finally {
    if (activeCloneControllers.get(operationId) === ctrl) activeCloneControllers.delete(operationId)
  }
}

export function abortCloneOperation(operationId: string): boolean {
  if (!isValidCloneOperationId(operationId)) return false
  const active = activeCloneControllers.get(operationId)
  if (!active) return false
  active.abort()
  return true
}

async function probeGitRepository(cwd: string): Promise<ProbeAvailability> {
  const ok = await isGitRepo(cwd)
  if (ok) return { ok: true }
  const readable = await probeReadableDirectory(cwd)
  if (!readable.ok) return readable
  return { ok: false, message: 'error.not-git-repo' }
}

async function invalidateRepoReadModelAfterMutation(cwd: string, result: ExecResult): Promise<ExecResult> {
  if (!result.ok) return result
  await invalidateCachedRepoReadModel(cwd)
  publishRepoQueryInvalidation({ repoId: cwd, query: 'repo-snapshot' })
  return result
}

async function withMergedAbortSignal<T>(
  signals: Array<AbortSignal | undefined>,
  task: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal)
  if (activeSignals.length <= 1) return await task(activeSignals[0])
  if (typeof AbortSignal.any === 'function') return await task(AbortSignal.any(activeSignals))
  const ctrl = new AbortController()
  const abort = (event: Event) => {
    ctrl.abort((event.target as AbortSignal | null)?.reason)
  }
  for (const signal of activeSignals) {
    if (signal.aborted) {
      ctrl.abort(signal.reason)
      return await task(ctrl.signal)
    }
    signal.addEventListener('abort', abort)
  }
  try {
    return await task(ctrl.signal)
  } finally {
    for (const signal of activeSignals) signal.removeEventListener('abort', abort)
  }
}

async function runUserNetworkMutation(
  cwd: string,
  signal: AbortSignal | undefined,
  task: (signal: AbortSignal | undefined) => Promise<ExecResult>,
): Promise<ExecResult> {
  return await invalidateRepoReadModelAfterMutation(
    cwd,
    await runServerCancellable(cwd, 'user', async (networkSignal) => {
      return await withMergedAbortSignal([signal, networkSignal], task)
    }),
  )
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  let snapshot: RepoSnapshot | null
  if (isRemoteRepoId(cwd)) {
    const target = await resolveRemoteRepoTarget(cwd)
    const cached = await readCachedRepoSnapshot(cwd)
    if (cached) return cached
    const remoteSnapshot = await getRemoteSnapshot(target, { signal })
    if (signal?.aborted || !remoteSnapshot) return null
    snapshot = { branches: remoteSnapshot.branches, current: remoteSnapshot.current, remote: remoteSnapshot.remote }
  } else {
    if (!isValidCwd(cwd)) return null
    const available = await probeGitRepository(cwd)
    if (!available.ok) throw new Error(available.message)
    const cached = await readCachedRepoSnapshot(cwd)
    if (cached) return cached
    try {
      const worktrees = await getWorktrees(cwd, { signal })
      if (signal?.aborted) return null
      const branches = await getBranches(cwd, worktrees, { signal })
      if (signal?.aborted) return null
      const current = await getCurrentBranch(cwd, { signal })
      if (signal?.aborted) return null
      const remote = await getRemoteInfo(cwd, signal)
      if (signal?.aborted) return null
      snapshot = { branches, current, remote }
    } catch (err) {
      if (signal?.aborted) return null
      throw err
    }
  }
  if (signal?.aborted || !snapshot) return null
  await writeCachedRepoSnapshot(cwd, snapshot)
  return snapshot
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  if (isRemoteRepoId(cwd)) {
    const target = await resolveRemoteRepoTarget(cwd)
    const status = await getRemoteStatus(target, { signal })
    return signal?.aborted ? [] : status
  }
  if (!isValidCwd(cwd)) return []
  const available = await probeGitRepository(cwd)
  if (!available.ok) throw new Error(available.message)
  const status = await getWorkingStatus(cwd, { signal })
  return signal?.aborted ? [] : status
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
): Promise<PullRequestEntry[] | null> {
  if (!isValidCwd(cwd)) return null
  if (branches !== undefined && !Array.isArray(branches)) return null
  const mode: PullRequestFetchMode = options?.mode === 'summary' ? 'summary' : 'full'
  const branchSet =
    branches === undefined
      ? undefined
      : new Set(
          branches.filter((branch): branch is string => {
            return typeof branch === 'string' && branch.length > 0
          }),
        )
  if (branchSet?.size === 0) return []
  const branchNames = branchSet ? Array.from(branchSet) : undefined
  const cached = await readCachedPullRequests(cwd, branchNames, mode)
  if (cached) return cached
  if (cached !== undefined) return []
  const prs = await getBranchPullRequests(cwd, branchSet, { mode, signal: options?.signal })
  if (!prs) return null
  const entries = Array.from(prs, ([branch, pullRequest]) => ({ branch, pullRequest }))
  await writeCachedPullRequests(cwd, entries, { branches: branchNames, mode })
  return entries
}

export async function fetchRepository(cwd: string, kind: NetworkOpKind = 'user'): Promise<{ ok: boolean; message: string }> {
  async function runFetch(task: (signal: AbortSignal) => Promise<{ ok: boolean; message: string }>) {
    const result = await runServerCancellable(cwd, kind, task)
    if (result.ok) {
      await invalidateCachedRepoReadModel(cwd)
      publishRepoQueryInvalidation({ repoId: cwd, query: 'repo-snapshot' })
    }
    return result
  }
  async function executeFetch(): Promise<{ ok: boolean; message: string }> {
    if (isRemoteRepoId(cwd)) {
      let target: RemoteRepoTarget
      try {
        target = await resolveRemoteRepoTarget(cwd)
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'error.ssh-config-changed' }
      }
      return await runFetch((signal) => fetchRemoteRepository(target, { signal }))
    }
    if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
    const available = await probeGitRepository(cwd)
    if (!available.ok) return available
    return await runFetch((signal) => fetchAll(cwd, signal))
  }

  if (kind === 'user') {
    const backgroundFetch = activeBackgroundFetches.get(cwd)
    if (backgroundFetch) return await backgroundFetch
    return await executeFetch()
  }

  const existingBackgroundFetch = activeBackgroundFetches.get(cwd)
  if (existingBackgroundFetch) return await existingBackgroundFetch
  const backgroundFetch = executeFetch().finally(() => {
    if (activeBackgroundFetches.get(cwd) === backgroundFetch) activeBackgroundFetches.delete(cwd)
  })
  activeBackgroundFetches.set(cwd, backgroundFetch)
  return await backgroundFetch
}

export async function checkoutRepositoryBranch(cwd: string, branch: string, signal?: AbortSignal): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await invalidateRepoReadModelAfterMutation(
      cwd,
      await checkoutRemoteBranch(await resolveRemoteRepoTarget(cwd), branch, undefined, { signal }),
    )
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await invalidateRepoReadModelAfterMutation(cwd, await checkoutBranch(cwd, branch, signal))
}

export async function pullRepositoryBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await runUserNetworkMutation(cwd, signal, async (mergedSignal) => {
      return await pullRemoteBranch(await resolveRemoteRepoTarget(cwd), branch, worktreePath, { signal: mergedSignal })
    })
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await runUserNetworkMutation(cwd, signal, async (mergedSignal) => {
    return await pullBranch(cwd, branch, worktreePath, mergedSignal)
  })
}

export async function pushRepositoryBranch(cwd: string, branch: string, signal?: AbortSignal): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await runUserNetworkMutation(cwd, signal, async (mergedSignal) => {
      return await pushRemoteBranch(await resolveRemoteRepoTarget(cwd), branch, { signal: mergedSignal })
    })
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await runUserNetworkMutation(cwd, signal, async (mergedSignal) => {
    return await pushBranch(cwd, branch, mergedSignal)
  })
}

export async function createRepositoryWorktree(
  cwd: string,
  worktreePath: string,
  newBranch: string,
  baseBranch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await invalidateRepoReadModelAfterMutation(
      cwd,
      await createRemoteWorktree(await resolveRemoteRepoTarget(cwd), { worktreePath, newBranch, baseBranch, signal }),
    )
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await invalidateRepoReadModelAfterMutation(cwd, await createWorktree(cwd, worktreePath, newBranch, baseBranch, signal))
}

async function deleteRepositoryBranchImpl(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await deleteRemoteBranch(await resolveRemoteRepoTarget(cwd), { branch, force: options?.force, signal })
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const current = await getCurrentBranch(cwd, { signal })
  if (branch === current) return { ok: false, message: 'error.cannot-delete-current-branch' }
  const worktrees = await getWorktrees(cwd, { includeStatus: false, signal })
  if (worktrees.some((wt) => wt.branch === branch)) return { ok: false, message: 'error.cannot-delete-checked-out-branch' }
  if (!options?.force) {
    const defaultBranch = await getDefaultBranch(cwd, { signal })
    const mergedToDefault = defaultBranch ? await isAncestor(cwd, branch, defaultBranch, signal) : false
    const upstream = await getUpstream(cwd, branch, signal)
    const mergedToUpstream = upstream ? await isAncestor(cwd, branch, upstream, signal) : false
    if (!mergedToDefault && !mergedToUpstream) return { ok: false, message: 'error.branch-not-fully-merged' }
  }
  const upstream = options?.alsoDeleteUpstream ? await getUpstream(cwd, branch, signal) : null
  const deleted = await deleteBranch(cwd, branch, { force: options?.force, signal })
  if (!deleted.ok || !upstream) return deleted
  const slash = upstream.indexOf('/')
  if (slash <= 0) return deleted
  return await deleteUpstreamBranch(cwd, upstream.slice(0, slash), upstream.slice(slash + 1), signal)
}

export async function deleteRepositoryBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await invalidateRepoReadModelAfterMutation(
      cwd,
      await deleteRemoteBranch(await resolveRemoteRepoTarget(cwd), { branch, force: options?.force, signal }),
    )
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await invalidateRepoReadModelAfterMutation(cwd, await deleteRepositoryBranchImpl(cwd, branch, options, signal))
}

export async function removeRepositoryWorktree(
  cwd: string,
  input: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) {
    return await invalidateRepoReadModelAfterMutation(
      cwd,
      await removeRemoteWorktree(await resolveRemoteRepoTarget(cwd), { ...input, signal }),
    )
  }
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const worktrees = await getWorktrees(cwd, { signal })
  const removable = resolveRemovableWorktree(worktrees, input.branch, input.worktreePath, cwd)
  if (!removable.ok) return { ok: false, message: removable.message }
  if ((removable.target.changeCount ?? 0) > 0) return { ok: false, message: 'error.cannot-remove-dirty-worktree' }
  const removed = await removeWorktree(cwd, removable.target.path, signal)
  if (!removed.ok) return removed
  if (!input.alsoDeleteBranch) return await invalidateRepoReadModelAfterMutation(cwd, removed)
  return await invalidateRepoReadModelAfterMutation(
    cwd,
    await deleteRepositoryBranchImpl(
      cwd,
      input.branch,
      { force: input.forceDeleteBranch, alsoDeleteUpstream: input.alsoDeleteUpstream },
      signal,
    ),
  )
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  if (isRemoteRepoId(cwd)) return await getRemotePatch(await resolveRemoteRepoTarget(cwd), worktreePath, { signal })
  if (!isValidCwd(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  const worktrees = await getWorktrees(cwd, { includeStatus: false, signal })
  const known = resolveKnownWorktree(worktrees, worktreePath)
  if (!known.ok) return { ok: false, message: known.message }
  try {
    return { ok: true, message: await getWorktreePatch(known.path, { signal }) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export async function openRepositoryRemote(cwd: string, branch?: string, signal?: AbortSignal): Promise<ExecResult> {
  const url = isRemoteRepoId(cwd)
    ? await getRemoteBrowserUrl(await resolveRemoteRepoTarget(cwd), branch, { signal })
    : await getBrowserRemoteUrl(cwd, { branch, signal })
  return url ? { ok: true, message: url } : { ok: false, message: 'error.no-remote-url' }
}

export async function openRepositoryTerminal(path: string): Promise<ExecResult> {
  const prefs = await getServerSettingsPrefs()
  return await openInPreferredTerminal(path, prefs.terminalApp)
}

export async function openRepositoryEditor(path: string): Promise<ExecResult> {
  const prefs = await getServerSettingsPrefs()
  return await openInPreferredEditor(path, prefs.editorApp)
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await setRegisteredBackgroundSyncRepos(repoIds)
}

export function getBackgroundSyncRepos(): string[] {
  return getRegisteredBackgroundSyncRepos()
}

export function abortRepositoryOperation(cwd: string): boolean {
  if (!isValidRepoLocator(cwd)) return false
  return abortServerNetworkOp(cwd)
}
