import { runWithRepoSource, type RepoSource } from '#/server/modules/repo-source.ts'
import type { WorkspacePaneTargetIdentity } from '#/shared/git-types.ts'
import type { RepoSourceRuntimeContext } from '#/server/modules/remote-repo-execution.ts'
import {
  getRepoLastSuccessfulFetchAt,
  listRepoWriteOperationsForRepo,
  resolveRepoWriteBoundaryForRead,
  runWithRepoMembershipReadAdmission,
} from '#/server/modules/repo-write-operation-coordinator.ts'
import { isValidWorkspaceLocatorInput } from '#/shared/input-validation.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type ExecResult,
  type LogEntry,
  type RepoLogTarget,
  type WorktreeStatus,
} from '#/shared/git-types.ts'
import type {
  PullRequestEntry,
  RepoPullRequestScope,
  RepoPullRequestsResponse,
  RepoSnapshotResponse,
  RepoOperationsSnapshot,
  RepoWorktreeStatusSnapshot,
  RepoSnapshot,
} from '#/shared/api-types.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export async function getRepoSnapshot(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<RepoSnapshot | null> {
  return await runRepoMembershipRead(cwd, options, async (source) => {
    return await source.getSnapshot({ signal: options.signal })
  })
}

export async function getWorkspacePaneTargetIdentities(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<WorkspacePaneTargetIdentity[]> {
  return await runRepoMembershipRead(cwd, options, async (source) => {
    return await source.getWorkspacePaneTargetIdentities({ signal: options.signal })
  })
}

export async function getRepoStatus(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string } = {},
): Promise<WorktreeStatus[]> {
  return await runRepoMembershipRead(cwd, options, async (source) => {
    return await source.getStatus({ signal: options.signal })
  })
}

async function runRepoMembershipRead<T>(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId?: string },
  read: (source: RepoSource) => Promise<T>,
): Promise<T> {
  options.signal?.throwIfAborted()
  const boundary = await resolveRepoWriteBoundaryForRead(cwd, options)
  return await runWithRepoMembershipReadAdmission(boundary, async () => {
    const result = await runWithRepoSource(cwd, read, repoReadRuntime(options), options.signal)
    options.signal?.throwIfAborted()
    return result
  })
}

export async function getRepoPullRequests(
  cwd: WorkspaceId,
  scope: RepoPullRequestScope,
  options?: { signal?: AbortSignal; workspaceRuntimeId?: string },
): Promise<PullRequestEntry[] | null> {
  const prs = await runWithRepoSource(
    cwd,
    async (source) => await source.getPullRequests(scope, { signal: options?.signal }),
    repoReadRuntime(options),
    options?.signal,
  )
  if (!prs) return null
  if (scope.kind === 'branch-detail' && (prs.length > 1 || prs.some((entry) => entry.branch !== scope.branch))) {
    throw new Error('repository pull request response did not match requested branch')
  }
  return prs
}

export async function getRepoLog(
  cwd: WorkspaceId,
  target: RepoLogTarget,
  options?: { count?: number; skip?: number; signal?: AbortSignal; workspaceRuntimeId?: string },
): Promise<LogEntry[]> {
  return await runWithRepoSource(
    cwd,
    async (source) =>
      await source.getLog(target, {
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

/**
 * Default deadline for an individual repository snapshot or pull-request
 * read. Each endpoint owns its timer independently. The read is bounded by
 * `timeoutMs` regardless of what
 * the underlying git / network operation would have done. Set to
 * `0` to disable the timeout.
 */
export const DEFAULT_REPO_READ_TIMEOUT_MS = 15_000

export interface RepoReadOptions {
  signal?: AbortSignal
  workspaceRuntimeId?: string
  /** Per-read timeout in ms. `0` disables. Default 15 000. */
  timeoutMs?: number
}

export interface RepoOperationsReadOptions {
  includeSettled?: boolean
  signal?: AbortSignal
  workspaceRuntimeId?: string
}

/**
 * Build a per-read boundary that fires when either the
 * caller's signal or the timeout fires. The timeout is a hard cap
 * independent of any source-specific backoff; its job is to bound
 * how long a repository read can block the request worker.
 */
function createRepoReadBoundary(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal
  waitFor: <T>(read: Promise<T>) => Promise<T>
  cancel: () => void
} {
  // Fast path: no caller signal and no timeout — return a fresh,
  // never-aborting signal so downstream code can treat the
  // return value uniformly without `as unknown as AbortSignal`
  // casts or `signal?.aborted` short-circuits everywhere.
  if (!callerSignal && (!timeoutMs || timeoutMs <= 0)) {
    return {
      signal: new AbortController().signal,
      waitFor: async <T>(read: Promise<T>) => await read,
      cancel: () => {},
    }
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
    waitFor: async <T>(read: Promise<T>) => {
      if (controller.signal.aborted) throw controller.signal.reason
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      })
      return await Promise.race([read, aborted])
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
    },
  }
}

export async function readRepoSnapshot(cwd: WorkspaceId, options: RepoReadOptions = {}): Promise<RepoSnapshotResponse> {
  const ctl = createRepoReadBoundary(options.signal, options.timeoutMs ?? DEFAULT_REPO_READ_TIMEOUT_MS)
  try {
    const snapshot = await ctl.waitFor(
      getRepoSnapshot(cwd, { signal: ctl.signal, workspaceRuntimeId: options.workspaceRuntimeId }),
    )
    if (!snapshot) throw new Error('repository snapshot unavailable')
    return { snapshot }
  } finally {
    ctl.cancel()
  }
}

export async function readRepoPullRequests(
  cwd: WorkspaceId,
  scope: RepoPullRequestScope,
  options: RepoReadOptions = {},
): Promise<RepoPullRequestsResponse> {
  const ctl = createRepoReadBoundary(options.signal, options.timeoutMs ?? DEFAULT_REPO_READ_TIMEOUT_MS)
  try {
    return {
      pullRequests: await ctl.waitFor(
        getRepoPullRequests(cwd, scope, {
          signal: ctl.signal,
          workspaceRuntimeId: options.workspaceRuntimeId,
        }),
      ),
    }
  } finally {
    ctl.cancel()
  }
}

export async function readRepoWorktreeStatus(
  cwd: WorkspaceId,
  options: { signal?: AbortSignal; workspaceRuntimeId: string },
): Promise<RepoWorktreeStatusSnapshot> {
  return {
    workspaceRuntimeId: options.workspaceRuntimeId,
    status: await getRepoStatus(cwd, { signal: options.signal, workspaceRuntimeId: options.workspaceRuntimeId }),
    loadedAt: Date.now(),
  }
}

function repoReadRuntime(options: { workspaceRuntimeId?: string } | undefined): RepoSourceRuntimeContext | undefined {
  return options?.workspaceRuntimeId ? { workspaceRuntimeId: options.workspaceRuntimeId } : undefined
}

export async function readRepoOperationsSnapshot(
  cwd: WorkspaceId,
  options: RepoOperationsReadOptions = {},
): Promise<RepoOperationsSnapshot> {
  // Operation activity is process-local coordinator authority. Reading it
  // must not probe Git or SSH, especially while a runtime failure is being
  // settled and this projection is invalidated.
  const writeOperations = await listRepoWriteOperationsForRepo(cwd, options)
  const lastFetchAt = getRepoLastSuccessfulFetchAt(cwd)
  return {
    operations: writeOperations,
    lastFetchAt,
    loadedAt: Date.now(),
  }
}
