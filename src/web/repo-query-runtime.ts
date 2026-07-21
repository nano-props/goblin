import { hashKey, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoOperations, getRepoProjection, getRepoWorktreeStatus } from '#/web/repo-client.ts'
import type {
  RepoOperationsSnapshot,
  GitWorkspaceRuntimeProjection,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  normalizeRepoProjectionBranch,
  normalizeRepoProjectionMode,
  repoDataQueryKey,
  repoOperationsQueryKey,
  repoOperationsQueryPrefix,
  repoProjectionQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'

class StaleRepoRuntimeReadError extends Error {
  constructor() {
    super('Stale workspace runtime read')
    this.name = 'StaleRepoRuntimeReadError'
  }
}

class MismatchedRepoRuntimeReadError extends Error {
  constructor() {
    super('error.failed-read-repo', { cause: new Error('Mismatched workspace runtime read') })
    this.name = 'MismatchedRepoRuntimeReadError'
  }
}

const repoSnapshotInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()
const worktreeStatusInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()
const operationsInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()
const repoProjectionFetchInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()

function repoRuntimeScopeKey(repoRoot: WorkspaceId, workspaceRuntimeId: string): string {
  return `${repoRoot}\0${workspaceRuntimeId}`
}

function repoSnapshotInvalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let map = repoSnapshotInvalidationVersionsByClient.get(queryClient)
  if (!map) {
    map = new Map()
    repoSnapshotInvalidationVersionsByClient.set(queryClient, map)
  }
  return map
}

function operationsInvalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let map = operationsInvalidationVersionsByClient.get(queryClient)
  if (!map) {
    map = new Map()
    operationsInvalidationVersionsByClient.set(queryClient, map)
  }
  return map
}

function worktreeStatusInvalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let map = worktreeStatusInvalidationVersionsByClient.get(queryClient)
  if (!map) {
    map = new Map()
    worktreeStatusInvalidationVersionsByClient.set(queryClient, map)
  }
  return map
}

function repoProjectionFetchInvalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let map = repoProjectionFetchInvalidationVersionsByClient.get(queryClient)
  if (!map) {
    map = new Map()
    repoProjectionFetchInvalidationVersionsByClient.set(queryClient, map)
  }
  return map
}

function repoProjectionFetchVersionKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
): string {
  return `${repoRoot}\0${workspaceRuntimeId}\0${branch ?? ''}\0${mode}`
}

function getRepoSnapshotInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): number {
  return repoSnapshotInvalidationVersionMap(queryClient).get(repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)) ?? 0
}

function bumpRepoSnapshotInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): void {
  const map = repoSnapshotInvalidationVersionMap(queryClient)
  const key = repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

function getRepoOperationsInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): number {
  return operationsInvalidationVersionMap(queryClient).get(repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)) ?? 0
}

function getRepoWorktreeStatusInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): number {
  return worktreeStatusInvalidationVersionMap(queryClient).get(repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)) ?? 0
}

function bumpRepoWorktreeStatusInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): void {
  const map = worktreeStatusInvalidationVersionMap(queryClient)
  const key = repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

function bumpRepoOperationsInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): void {
  const map = operationsInvalidationVersionMap(queryClient)
  const key = repoRuntimeScopeKey(repoRoot, workspaceRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

function markRepoProjectionFetchStarted(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): number {
  const version = getRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  repoProjectionFetchInvalidationVersionMap(queryClient).set(
    repoProjectionFetchVersionKey(repoRoot, workspaceRuntimeId, branch, mode),
    version,
  )
  return version
}

export function isStaleRepoRuntimeReadError(err: unknown): boolean {
  return err instanceof StaleRepoRuntimeReadError
}

export function getRepoProjectionFetchInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): number | null {
  return (
    repoProjectionFetchInvalidationVersionMap(queryClient).get(
      repoProjectionFetchVersionKey(repoRoot, workspaceRuntimeId, branch, mode),
    ) ?? null
  )
}

export function clearRepoProjectionFetchInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  repoProjectionFetchInvalidationVersionMap(queryClient).delete(
    repoProjectionFetchVersionKey(repoRoot, workspaceRuntimeId, branch, mode),
  )
}

function markRepoSnapshotInvalidated(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  bumpRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
}

function invalidateActiveRepoSnapshotQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
  options: { excludeProjectionQueryKey?: readonly unknown[] } = {},
): void {
  const excludedProjectionHash = options.excludeProjectionQueryKey ? hashKey(options.excludeProjectionQueryKey) : null
  void queryClient.invalidateQueries(
    {
      queryKey: repoDataQueryKey(repoRoot, workspaceRuntimeId),
      refetchType: 'active',
      predicate: (query) => {
        const kind = query.queryKey[3]
        if (kind === 'projection') return !excludedProjectionHash || query.queryHash !== excludedProjectionHash
        return kind === 'worktree-status' || kind === 'log' || kind === 'remote-branches'
      },
    },
    { cancelRefetch: false },
  )
}

async function invalidateExactRepoProjectionQuery(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof repoProjectionQueryKey>,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' }, { cancelRefetch: false })
}

function hasRepoProjectionFetchInProgress(queryClient: QueryClient, queryKey: readonly unknown[]): boolean {
  const status = queryClient.getQueryState(queryKey)?.fetchStatus
  return status === 'fetching' || status === 'paused'
}

async function abortablePromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise
  signal.throwIfAborted()
  let abort: (() => void) | null = null
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    return await Promise.race([promise, abortPromise])
  } finally {
    if (abort) signal.removeEventListener('abort', abort)
  }
}

export async function fetchRepoProjectionReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<GitWorkspaceRuntimeProjection> {
  const startedVersion = markRepoProjectionFetchStarted(repoRoot, workspaceRuntimeId, branch, mode, queryClient)
  const projection = await getRepoProjection(repoRoot, workspaceRuntimeId, branch, { mode }, signal)
  signal.throwIfAborted()
  if (startedVersion < getRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return projection
}

export async function fetchRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoWorktreeStatusSnapshot> {
  const startedVersion = getRepoWorktreeStatusInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  let snapshot: RepoWorktreeStatusSnapshot
  try {
    snapshot = await getRepoWorktreeStatus(repoRoot, workspaceRuntimeId, signal)
  } catch (err) {
    if (startedVersion < getRepoWorktreeStatusInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
      throw new StaleRepoRuntimeReadError()
    }
    throw err
  }
  signal.throwIfAborted()
  if (snapshot.workspaceRuntimeId !== workspaceRuntimeId) throw new MismatchedRepoRuntimeReadError()
  if (startedVersion < getRepoWorktreeStatusInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return snapshot
}

export async function fetchRepoSnapshotQuery<T>(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  queryClient: QueryClient,
  read: () => Promise<T>,
): Promise<T> {
  const startedVersion = getRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  try {
    const result = await read()
    signal.throwIfAborted()
    if (startedVersion < getRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
      throw new StaleRepoRuntimeReadError()
    }
    return result
  } catch (err) {
    signal.throwIfAborted()
    if (startedVersion < getRepoSnapshotInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
      throw new StaleRepoRuntimeReadError()
    }
    throw err
  }
}

export async function fetchRepoOperationsReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  includeSettled: boolean,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoOperationsSnapshot> {
  const startedVersion = getRepoOperationsInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  const operations = await getRepoOperations(repoRoot, workspaceRuntimeId, { includeSettled, signal })
  signal.throwIfAborted()
  if (startedVersion < getRepoOperationsInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return operations
}

interface RepoProjectionRefreshReadInput {
  repoRoot: WorkspaceId
  workspaceRuntimeId: string
  branch: string | null
  mode: PullRequestFetchMode
  queryClient: QueryClient
  queryKey: ReturnType<typeof repoProjectionQueryKey>
  signal?: AbortSignal
}

async function beginRepoProjectionReadModelRefresh(input: RepoProjectionRefreshReadInput): Promise<void> {
  markRepoSnapshotInvalidated(input.repoRoot, input.workspaceRuntimeId, input.queryClient)
  bumpRepoWorktreeStatusInvalidationVersion(input.repoRoot, input.workspaceRuntimeId, input.queryClient)
  invalidateActiveRepoSnapshotQueries(input.repoRoot, input.workspaceRuntimeId, input.queryClient, {
    excludeProjectionQueryKey: input.queryKey,
  })
  await invalidateExactRepoProjectionQuery(input.queryClient, input.queryKey)
}

async function fetchRepoProjectionReadModelOnce(
  input: RepoProjectionRefreshReadInput,
): Promise<GitWorkspaceRuntimeProjection> {
  const hasSharedFetchInProgress = hasRepoProjectionFetchInProgress(input.queryClient, input.queryKey)
  const projectionPromise = input.queryClient.fetchQuery({
    queryKey: input.queryKey,
    retry: (_failureCount, error) => isStaleRepoRuntimeReadError(error),
    retryDelay: 0,
    staleTime: 0,
    queryFn: ({ signal }) =>
      fetchRepoProjectionReadModel(
        input.repoRoot,
        input.workspaceRuntimeId,
        input.branch,
        input.mode,
        input.signal && !hasSharedFetchInProgress ? AbortSignal.any([signal, input.signal]) : signal,
        input.queryClient,
      ),
  })
  return await abortablePromise(projectionPromise, input.signal)
}

function repoProjectionReadCurrent(input: RepoProjectionRefreshReadInput): boolean {
  const fetchInvalidationVersion = getRepoProjectionFetchInvalidationVersion(
    input.repoRoot,
    input.workspaceRuntimeId,
    input.branch,
    input.mode,
    input.queryClient,
  )
  return (
    fetchInvalidationVersion ===
      getRepoSnapshotInvalidationVersion(input.repoRoot, input.workspaceRuntimeId, input.queryClient) &&
    input.queryClient.getQueryState(input.queryKey)?.isInvalidated !== true
  )
}

async function fetchRepoProjectionReadModelUntilCurrent(
  input: RepoProjectionRefreshReadInput,
): Promise<GitWorkspaceRuntimeProjection> {
  for (;;) {
    let projection: GitWorkspaceRuntimeProjection
    try {
      projection = await fetchRepoProjectionReadModelOnce(input)
    } catch (err) {
      if (!isStaleRepoRuntimeReadError(err)) throw err
      await invalidateExactRepoProjectionQuery(input.queryClient, input.queryKey)
      input.signal?.throwIfAborted()
      continue
    }
    input.signal?.throwIfAborted()
    if (repoProjectionReadCurrent(input)) return projection
    await invalidateExactRepoProjectionQuery(input.queryClient, input.queryKey)
    input.signal?.throwIfAborted()
  }
}

export async function refreshRepoProjectionReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<GitWorkspaceRuntimeProjection> {
  options.signal?.throwIfAborted()
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const requestedBranch = normalizeRepoProjectionBranch(branch)
  const requestedMode = normalizeRepoProjectionMode(mode)
  const queryKey = repoProjectionQueryKey(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode)
  const refreshReadInput: RepoProjectionRefreshReadInput = {
    repoRoot,
    workspaceRuntimeId,
    branch: requestedBranch,
    mode: requestedMode,
    queryClient,
    queryKey,
    signal: options.signal,
  }
  await beginRepoProjectionReadModelRefresh(refreshReadInput)
  options.signal?.throwIfAborted()
  const projection = await fetchRepoProjectionReadModelUntilCurrent(refreshReadInput)
  return projection
}

export async function refreshRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<RepoWorktreeStatusSnapshot> {
  options.signal?.throwIfAborted()
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const queryKey = repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId)
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' }, { cancelRefetch: false })
  for (;;) {
    try {
      const snapshot = await abortablePromise(
        queryClient.fetchQuery({
          queryKey,
          retry: (_failureCount, error) => isStaleRepoRuntimeReadError(error),
          retryDelay: 0,
          staleTime: 0,
          queryFn: ({ signal }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, queryClient),
        }),
        options.signal,
      )
      options.signal?.throwIfAborted()
      if (queryClient.getQueryState(queryKey)?.isInvalidated !== true) return snapshot
    } catch (err) {
      if (!isStaleRepoRuntimeReadError(err)) throw err
    }
    await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' }, { cancelRefetch: false })
    options.signal?.throwIfAborted()
  }
}

export function invalidateRepoSnapshotQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  markRepoSnapshotInvalidated(repoRoot, workspaceRuntimeId, queryClient)
  bumpRepoWorktreeStatusInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  invalidateActiveRepoSnapshotQueries(repoRoot, workspaceRuntimeId, queryClient)
}

export function invalidateRepoWorktreeSnapshotQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  bumpRepoWorktreeStatusInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  void queryClient.invalidateQueries(
    {
      queryKey: repoDataQueryKey(repoRoot, workspaceRuntimeId),
      refetchType: 'active',
      predicate: (query) => query.queryKey[3] === 'worktree-status',
    },
    { cancelRefetch: false },
  )
}

export function invalidateRepoOperationsQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  bumpRepoOperationsInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  void queryClient.invalidateQueries(
    { queryKey: repoOperationsQueryPrefix(repoRoot, workspaceRuntimeId), refetchType: 'active' },
    { cancelRefetch: false },
  )
}
