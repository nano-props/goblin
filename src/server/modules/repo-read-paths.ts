import { runWithRepoSource, type RepoSourceRuntimeContext } from '#/server/modules/repo-source.ts'
import { getRepoOperationsSnapshot } from '#/server/modules/repo-operation-registry.ts'
import { listRepoWriteOperationsForRepo } from '#/server/modules/repo-write-operation-coordinator.ts'
import { isValidRepoLocator } from '#/shared/input-validation.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type ExecResult,
  type LogEntry,
  type PullRequestFetchMode,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import type {
  ProbeResult,
  PullRequestEntry,
  RepoOperationsSnapshot,
  RepoRuntimeProjection,
  RepoServerOperationState,
  RepoSnapshot,
} from '#/shared/api-types.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'

export async function probeRepo(cwd: string): Promise<ProbeResult> {
  return await runWithRepoSource(cwd, async (source) => await source.probe())
}

export async function getRepoSnapshot(
  cwd: string,
  options: { signal?: AbortSignal; repoRuntimeId?: string } = {},
): Promise<RepoSnapshot | null> {
  return options.signal?.aborted
    ? null
    : await runWithRepoSource(
        cwd,
        async (source) => await source.getSnapshot(options.signal),
        repoReadRuntime(options),
      )
}

export async function getRepoStatus(
  cwd: string,
  options: { signal?: AbortSignal; repoRuntimeId?: string } = {},
): Promise<WorktreeStatus[]> {
  return options.signal?.aborted
    ? []
    : await runWithRepoSource(cwd, async (source) => await source.getStatus(options.signal), repoReadRuntime(options))
}

export async function getRepoPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal; repoRuntimeId?: string },
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
  cwd: string,
  branch: string,
  options?: { count?: number; skip?: number; signal?: AbortSignal; repoRuntimeId?: string },
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
  cwd: string,
  worktreePath: string,
  options: { signal?: AbortSignal; repoRuntimeId?: string } = {},
): Promise<ExecResult> {
  return await runWithRepoSource(
    cwd,
    async (source) => await source.getPatch(worktreePath, options.signal),
    repoReadRuntime(options),
  )
}

export async function getRepoWorktreeBootstrapPreview(
  cwd: string,
  signal?: AbortSignal,
): Promise<WorktreeBootstrapPreviewResult> {
  if (!isValidRepoLocator(cwd)) return { ok: false, message: 'error.invalid-arguments' }
  return await runWithRepoSource(cwd, async (source) => await source.getWorktreeBootstrapPreview(signal))
}

export type RepoBulkReadSection = 'snapshot' | 'status' | 'pullRequests'

export interface RepoBulkReadResult {
  snapshot: RepoSnapshot | null
  status: WorktreeStatus[]
  pullRequests: PullRequestEntry[] | null
}

/**
 * Default per-section deadline for the composite endpoint. Each
 * included section (snapshot / status / pullRequests) gets its own
 * timer; the slowest leg is bounded by `timeoutMs` regardless of what
 * the underlying git / network operation would have done. Set to
 * `0` to disable the timeout.
 */
export const DEFAULT_BULK_READ_TIMEOUT_MS = 15_000

export interface RepoBulkReadOptions {
  branches?: string[]
  mode?: PullRequestFetchMode
  signal?: AbortSignal
  repoRuntimeId?: string
  /** Per-section timeout in ms. `0` disables. Default 15 000. */
  timeoutMs?: number
}

export interface RepoProjectionReadOptions {
  branch?: string
  mode?: PullRequestFetchMode
  signal?: AbortSignal
  timeoutMs?: number
  repoRuntimeId?: string
}

export interface RepoOperationsReadOptions {
  includeSettled?: boolean
  signal?: AbortSignal
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
 * how long the composite endpoint can block the request worker.
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
    timer = setTimeout(() => controller.abort(new Error('composite section timeout')), timeoutMs)
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
 * Fetch several repo read results in parallel. Each field is independent:
 * requested section fails the whole composite read fails; callers must not
 * mistake a missing section for authoritative empty repo data. The composite
 * request is aborted when the caller's signal fires, and each section
 * additionally gets a hard `timeoutMs` deadline so a slow git / network
 * operation cannot pin the request worker.
 */
export async function readRepoBulk(
  cwd: string,
  includes: ReadonlyArray<RepoBulkReadSection>,
  options: RepoBulkReadOptions = {},
): Promise<RepoBulkReadResult> {
  const { branches, mode, signal, timeoutMs = DEFAULT_BULK_READ_TIMEOUT_MS } = options
  const want = (name: RepoBulkReadSection) => includes.includes(name)

  // One signal per section so the slow leg can be cancelled
  // independently — the others keep going. We materialise the
  // controllers up front and only attach a timeout where the caller
  // asked for one.
  const snapshotCtl = want('snapshot') ? composeSectionSignal(signal, timeoutMs) : null
  const statusCtl = want('status') ? composeSectionSignal(signal, timeoutMs) : null
  const prsCtl = want('pullRequests') ? composeSectionSignal(signal, timeoutMs) : null

  try {
    const [snapshot, status, pullRequests] = await Promise.all([
      snapshotCtl
        ? getRepoSnapshot(cwd, { signal: snapshotCtl.signal, repoRuntimeId: options.repoRuntimeId }).finally(() =>
            snapshotCtl.cancel(),
          )
        : Promise.resolve(null as RepoSnapshot | null),
      statusCtl
        ? getRepoStatus(cwd, { signal: statusCtl.signal, repoRuntimeId: options.repoRuntimeId }).finally(() =>
            statusCtl.cancel(),
          )
        : Promise.resolve([] as WorktreeStatus[]),
      prsCtl
        ? getRepoPullRequests(cwd, branches, {
            mode,
            signal: prsCtl.signal,
            repoRuntimeId: options.repoRuntimeId,
          }).finally(() => prsCtl.cancel())
        : Promise.resolve(null as PullRequestEntry[] | null),
    ])
    return { snapshot, status, pullRequests }
  } finally {
    snapshotCtl?.cancel()
    statusCtl?.cancel()
    prsCtl?.cancel()
  }
}

export async function readRepoProjection(
  cwd: string,
  options: RepoProjectionReadOptions = {},
): Promise<RepoRuntimeProjection> {
  const branch = typeof options.branch === 'string' && options.branch.length > 0 ? options.branch : null
  const mode: PullRequestFetchMode = options.mode === 'summary' ? 'summary' : 'full'
  const includePullRequests = !!branch || mode === 'summary'
  const result = await readRepoBulk(
    cwd,
    includePullRequests ? ['snapshot', 'status', 'pullRequests'] : ['snapshot', 'status'],
    {
      branches: branch ? [branch] : undefined,
      mode,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      repoRuntimeId: options.repoRuntimeId,
    },
  )
  return {
    ...result,
    operations: await readRepoOperationsSnapshot(cwd, { signal: options.signal }),
    requested: {
      branch,
      pullRequestMode: mode,
    },
    loadedAt: Date.now(),
  }
}

function repoReadRuntime(options: { repoRuntimeId?: string } | undefined): RepoSourceRuntimeContext | undefined {
  return options?.repoRuntimeId ? { repoRuntimeId: options.repoRuntimeId } : undefined
}

export async function readRepoOperationsSnapshot(
  cwd?: string,
  options: RepoOperationsReadOptions = {},
): Promise<RepoOperationsSnapshot> {
  const registrySnapshot = getRepoOperationsSnapshot({
    repoId: cwd,
    includeSettled: options.includeSettled,
  })
  const writeOperations = await listRepoWriteOperationsForRepo(cwd, options)
  return {
    operations: sortedRepoOperations([...registrySnapshot.operations, ...writeOperations]),
    loadedAt: Date.now(),
  }
}
