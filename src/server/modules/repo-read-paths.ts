import { runWithRepoBackend } from '#/server/modules/repo-backend.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type ExecResult,
  type LogEntry,
  type PullRequestFetchMode,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import type { ProbeResult, PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'

export async function probeRepository(cwd: string): Promise<ProbeResult> {
  return await runWithRepoBackend(cwd, async (backend) => await backend.probe())
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  return signal?.aborted ? null : await runWithRepoBackend(cwd, async (backend) => await backend.getSnapshot(signal))
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return signal?.aborted ? [] : await runWithRepoBackend(cwd, async (backend) => await backend.getStatus(signal))
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
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
  const prs = await runWithRepoBackend(
    cwd,
    async (backend) => await backend.getPullRequests(branchNames, { mode, signal: options?.signal }),
  )
  if (!prs) return null
  return prs
}

export async function getRepositoryLog(
  cwd: string,
  branch: string,
  options?: { count?: number; skip?: number; signal?: AbortSignal },
): Promise<LogEntry[]> {
  if (typeof branch !== 'string' || branch.length === 0) return []
  return await runWithRepoBackend(
    cwd,
    async (backend) =>
      await backend.getLog(branch, {
        count: options?.count ?? DEFAULT_REPOSITORY_LOG_COUNT,
        skip: options?.skip ?? 0,
        signal: options?.signal,
      }),
  )
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await runWithRepoBackend(cwd, async (backend) => await backend.getPatch(worktreePath, signal))
}

export type CompositeInclude = 'snapshot' | 'status' | 'pullRequests'

export interface RepositoryComposite {
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
export const DEFAULT_COMPOSITE_TIMEOUT_MS = 15_000

export interface RepositoryCompositeOptions {
  branches?: string[]
  mode?: PullRequestFetchMode
  signal?: AbortSignal
  /** Per-section timeout in ms. `0` disables. Default 15 000. */
  timeoutMs?: number
}

/**
 * Build a per-section `AbortSignal` that fires when either the
 * caller's signal or the timeout fires. The timeout is a hard cap
 * independent of any backend-specific backoff; its job is to bound
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
 * failures are caught per-field and the entry is left in its default
 * (`null` / `[]`) state. The composite request is aborted when the
 * caller's signal fires, and each section additionally gets a hard
 * `timeoutMs` deadline so a slow git / network operation cannot pin
 * the request worker.
 */
export async function getRepositoryComposite(
  cwd: string,
  includes: ReadonlyArray<CompositeInclude>,
  options: RepositoryCompositeOptions = {},
): Promise<RepositoryComposite> {
  const { branches, mode, signal, timeoutMs = DEFAULT_COMPOSITE_TIMEOUT_MS } = options
  const want = (name: CompositeInclude) => includes.includes(name)

  // One signal per section so the slow leg can be cancelled
  // independently — the others keep going. We materialise the
  // controllers up front and only attach a timeout where the caller
  // asked for one.
  const snapshotCtl = want('snapshot') ? composeSectionSignal(signal, timeoutMs) : null
  const statusCtl = want('status') ? composeSectionSignal(signal, timeoutMs) : null
  const prsCtl = want('pullRequests') ? composeSectionSignal(signal, timeoutMs) : null

  try {
    const settled = await Promise.allSettled([
      snapshotCtl
        ? getRepositorySnapshot(cwd, snapshotCtl.signal).finally(() => snapshotCtl.cancel())
        : Promise.resolve(null as RepoSnapshot | null),
      statusCtl
        ? getRepositoryStatus(cwd, statusCtl.signal).finally(() => statusCtl.cancel())
        : Promise.resolve([] as WorktreeStatus[]),
      prsCtl
        ? getRepositoryPullRequests(cwd, branches, { mode, signal: prsCtl.signal }).finally(() => prsCtl.cancel())
        : Promise.resolve(null as PullRequestEntry[] | null),
    ])
    return {
      snapshot: settled[0]!.status === 'fulfilled' ? settled[0]!.value : null,
      status: settled[1]!.status === 'fulfilled' ? settled[1]!.value : [],
      pullRequests: settled[2]!.status === 'fulfilled' ? settled[2]!.value : null,
    }
  } finally {
    snapshotCtl?.cancel()
    statusCtl?.cancel()
    prsCtl?.cancel()
  }
}
