import {
  runWithRepoSource,
  type RepoSourceRuntimeContext,
  type WorkspacePaneTargetIdentity,
} from '#/server/modules/repo-source.ts'
import { getRepoOperationsSnapshot } from '#/server/modules/repo-operation-registry.ts'
import {
  listRepoWriteOperationsForBoundary,
  listRepoWriteOperationsForRepo,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import {
  getRepoBoundaryLastFetchAt,
  resolveRepoWriteBoundary,
} from '#/server/modules/repo-write-boundary-registry.ts'
import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type ExecResult,
  type LogEntry,
  type PullRequestFetchMode,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import type {
  PullRequestEntry,
  RepoOperationsSnapshot,
  GitWorkspaceRuntimeProjection,
  RepoWorktreeStatusSnapshot,
  RepoServerOperationState,
  RepoSnapshot,
} from '#/shared/api-types.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export async function getRepoSnapshot(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<RepoSnapshot | null> {
  return options.signal?.aborted
    ? null
    : await runWithRepoSource(cwd, async (source) => await source.getSnapshot(options.signal), repoReadRuntime(options))
}

export async function getWorkspacePaneTargetIdentities(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<WorkspacePaneTargetIdentity[]> {
  options.signal?.throwIfAborted()
  const identities = await runWithRepoSource(
    cwd,
    async (source) => await source.getWorkspacePaneTargetIdentities(options.signal),
    repoReadRuntime(options),
  )
  options.signal?.throwIfAborted()
  return identities
}

export async function getRepoStatus(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<WorktreeStatus[]> {
  options.signal?.throwIfAborted()
  const status = await runWithRepoSource(
    cwd,
    async (source) => await source.getStatus(options.signal),
    repoReadRuntime(options),
  )
  options.signal?.throwIfAborted()
  return status
}

export async function getRepoPullRequests(
  cwd: WorkspaceId,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal; workspaceRuntimeId?: string },
): Promise<PullRequestEntry[] | null> {
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
  const prs = await runWithRepoSource(
    cwd,
    async (source) => await source.getPullRequests(branchNames, { mode, signal: options?.signal }),
    repoReadRuntime(options),
  )
  if (!prs) return null
  return prs
}

export async function getRepoLog(
  cwd: WorkspaceId,
  branch: string,
  options?: { count?: number; skip?: number; signal?: AbortSignal; workspaceRuntimeId?: string },
): Promise<LogEntry[]> {
  if (typeof branch !== 'string' || branch.length === 0) return []
  return await runWithRepoSource(
    cwd,
    async (source) =>
      await source.getLog(branch, {
        count: options?.count ?? DEFAULT_REPOSITORY_LOG_COUNT,
        skip: options?.skip ?? 0,
        signal: options?.signal,
      }),
    repoReadRuntime(options),
  )
}

export async function getRepoPatch(
  cwd: WorkspaceId,
  worktreePath: string,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<ExecResult> {
  return await runWithRepoSource(
    cwd,
    async (source) => await source.getPatch(worktreePath, options.signal),
    repoReadRuntime(options),
  )
}

export async function getRepoWorktreeBootstrapPreview(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<WorktreeBootstrapPreviewResult> {
  if (!isValidWorkspaceLocatorInput(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await runWithRepoSource(
    cwd,
    async (source) => await source.getWorktreeBootstrapPreview(options.signal),
    repoReadRuntime(options),
  )
}

interface RepoProjectionSections {
  snapshot: RepoSnapshot | null
  pullRequests: PullRequestEntry[] | null
}

/**
 * Default deadline for an individual repository read. Each included
 * projection section (snapshot / pullRequests) gets its own
 * timer; the slowest leg is bounded by `timeoutMs` regardless of what
 * the underlying git / network operation would have done. Set to
 * `0` to disable the timeout.
 */
export const DEFAULT_REPO_READ_TIMEOUT_MS = 15_000

interface RepoProjectionSectionReadOptions {
  branches?: string[]
  includePullRequests: boolean
  mode?: PullRequestFetchMode
  signal?: AbortSignal
  workspaceRuntimeId?: string
  /** Per-section timeout in ms. `0` disables. Default 15 000. */
  timeoutMs?: number
}

export interface RepoProjectionReadOptions {
  branch?: string
  mode?: PullRequestFetchMode
  signal?: AbortSignal
  timeoutMs?: number
  workspaceRuntimeId?: string
}

export interface RepoOperationsReadOptions {
  includeSettled?: boolean
  signal?: AbortSignal
  workspaceRuntimeId?: string
}

function sortedRepoOperations(states: RepoServerOperationState[]): RepoServerOperationState[] {
  return [...states].sort((a, b) => {
    const aTime = a.settledAt ?? a.startedAt ?? a.queuedAt
    const bTime = b.settledAt ?? b.startedAt ?? b.queuedAt
    return bTime - aTime
  })
}

/**
 * Build a per-section `AbortSignal` that fires when either the
 * caller's signal or the timeout fires. The timeout is a hard cap
 * independent of any source-specific backoff; its job is to bound
 * how long a repository read can block the request worker.
 */
function composeSectionSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal
  cancel: () => void
} {
  // Fast path: no caller signal and no timeout — return a fresh,
  // never-aborting signal so downstream code can treat the
  // return value uniformly without `as unknown as AbortSignal`
  // casts or `signal?.aborted` short-circuits everywhere.
  if (!callerSignal && (!timeoutMs || timeoutMs <= 0)) {
    return { signal: new AbortController().signal, cancel: () => {} }
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(new Error('repository read timeout')), timeoutMs)
  }
  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal) {
    if (callerSignal.aborted) onCallerAbort()
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cancel: () => {
      if (timer) clearTimeout(timer)
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
    },
  }
}

/**
 * Fetch the requested projection sections in parallel. If any requested
 * section fails, the projection read fails; callers must not mistake a missing
 * section for authoritative empty repo data. The shared
 * request is aborted when the caller's signal fires, and each section
 * additionally gets a hard `timeoutMs` deadline so a slow git / network
 * operation cannot pin the request worker.
 */
async function readRepoProjectionSections(
  cwd: WorkspaceId,
  options: RepoProjectionSectionReadOptions,
): Promise<RepoProjectionSections> {
  const { branches, includePullRequests, mode, signal, timeoutMs = DEFAULT_REPO_READ_TIMEOUT_MS } = options

  // One signal per section so the slow leg can be cancelled
  // independently — the others keep going. We materialise the
  // controllers up front and only attach a timeout where the caller
  // asked for one.
  const snapshotCtl = composeSectionSignal(signal, timeoutMs)
  const prsCtl = includePullRequests ? composeSectionSignal(signal, timeoutMs) : null

  try {
    const [snapshot, pullRequests] = await Promise.all([
      getRepoSnapshot(cwd, { signal: snapshotCtl.signal, workspaceRuntimeId: options.workspaceRuntimeId }).finally(() =>
        snapshotCtl.cancel(),
      ),
      prsCtl
        ? getRepoPullRequests(cwd, branches, {
            mode,
            signal: prsCtl.signal,
            workspaceRuntimeId: options.workspaceRuntimeId,
          }).finally(() => prsCtl.cancel())
        : Promise.resolve(null as PullRequestEntry[] | null),
    ])
    return { snapshot, pullRequests }
  } finally {
    snapshotCtl.cancel()
    prsCtl?.cancel()
  }
}

export async function readRepoProjection(
  cwd: WorkspaceId,
  options: RepoProjectionReadOptions = {},
): Promise<GitWorkspaceRuntimeProjection> {
  const branch = typeof options.branch === 'string' && options.branch.length > 0 ? options.branch : null
  const mode: PullRequestFetchMode = options.mode === 'summary' ? 'summary' : 'full'
  const includePullRequests = !!branch || mode === 'summary'
  const result = await readRepoProjectionSections(cwd, {
    branches: branch ? [branch] : undefined,
    includePullRequests,
    mode,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    workspaceRuntimeId: options.workspaceRuntimeId,
  })
  return {
    snapshot: result.snapshot,
    pullRequests: result.pullRequests,
    requested: {
      branch,
      pullRequestMode: mode,
    },
    loadedAt: Date.now(),
  }
}

export async function readRepoWorktreeStatus(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId: string; timeoutMs?: number },
): Promise<RepoWorktreeStatusSnapshot> {
  const statusCtl = composeSectionSignal(options.signal, options.timeoutMs ?? DEFAULT_REPO_READ_TIMEOUT_MS)
  try {
    return {
      workspaceRuntimeId: options.workspaceRuntimeId,
      status: await getRepoStatus(cwd, { signal: statusCtl.signal, workspaceRuntimeId: options.workspaceRuntimeId }),
      loadedAt: Date.now(),
    }
  } finally {
    statusCtl.cancel()
  }
}

function repoReadRuntime(options: { workspaceRuntimeId?: string } | undefined): RepoSourceRuntimeContext | undefined {
  return options?.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined
}

export async function readRepoOperationsSnapshot(
  cwd?: WorkspaceId,
  options: RepoOperationsReadOptions = {},
): Promise<RepoOperationsSnapshot> {
  const registrySnapshot = getRepoOperationsSnapshot({
    repoId: cwd,
    workspaceRuntimeId: options.workspaceRuntimeId,
    includeSettled: options.includeSettled,
  })
  const boundaryKey = cwd ? await resolveRepoWriteBoundary(cwd, options.signal) : null
  const writeOperations =
    cwd && boundaryKey
      ? listRepoWriteOperationsForBoundary(cwd, boundaryKey, options)
      : await listRepoWriteOperationsForRepo(cwd, options)
  const lastFetchAt = boundaryKey ? getRepoBoundaryLastFetchAt(boundaryKey) : null
  return {
    operations: sortedRepoOperations([...registrySnapshot.operations, ...writeOperations]),
    lastFetchAt,
    loadedAt: Date.now(),
  }
}
