import { useEffect } from 'react'
import { hashKey, queryOptions, skipToken, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  getRepoLog,
  getRepoOperations,
  getRepoProjection,
  getRepoRemoteBranches,
  getRepoWorktreeStatus,
} from '#/web/repo-client.ts'
import type {
  RepoOperationsSnapshot,
  WorkspaceRuntimeProjection,
  RepoServerOperationState,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode } from '#/shared/git-types.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

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

const runtimeProjectionInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()
const repoProjectionFetchInvalidationVersionsByClient = new WeakMap<QueryClient, Map<string, number>>()

function normalizeProjectionBranch(branch?: string | null): string | null {
  return branch || null
}

function normalizeProjectionMode(mode?: PullRequestFetchMode): PullRequestFetchMode {
  return mode ?? 'full'
}

export function repoProjectionQueryKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  return [
    'repo-data',
    repoRoot,
    workspaceRuntimeId,
    'projection',
    { branch: normalizeProjectionBranch(branch), mode: normalizeProjectionMode(mode) },
  ] as const
}

export interface ParsedRepoProjectionQueryKey {
  repoRoot: WorkspaceId
  workspaceRuntimeId: string
  branch: string | null
  mode: PullRequestFetchMode
}

export function parseRepoProjectionQueryKey(queryKey: readonly unknown[]): ParsedRepoProjectionQueryKey | null {
  if (queryKey.length !== 5) return null
  if (queryKey[0] !== 'repo-data') return null
  if (queryKey[3] !== 'projection') return null
  const repoRoot = queryKey[1]
  const workspaceRuntimeId = queryKey[2]
  if (typeof repoRoot !== 'string' || typeof workspaceRuntimeId !== 'string') return null
  const workspaceId = canonicalWorkspaceLocator(repoRoot)
  if (!workspaceId) return null
  const options = queryKey[4]
  if (!options || typeof options !== 'object') return null
  const projection = options as { branch?: unknown; mode?: unknown }
  const branch = typeof projection.branch === 'string' && projection.branch.length > 0 ? projection.branch : null
  const mode = projection.mode === 'summary' ? 'summary' : 'full'
  return { repoRoot: workspaceId, workspaceRuntimeId, branch, mode }
}

export function repoOperationsQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string, includeSettled = false) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations', { includeSettled }] as const
}

export function repoWorktreeStatusQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-status'] as const
}

export function repoDataQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId] as const
}

function repoProjectionQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'projection'] as const
}

function repoOperationsQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations'] as const
}

function runtimeProjectionInvalidationKey(repoRoot: WorkspaceId, workspaceRuntimeId: string): string {
  return `${repoRoot}\0${workspaceRuntimeId}`
}

function runtimeProjectionInvalidationVersionMap(queryClient: QueryClient): Map<string, number> {
  let map = runtimeProjectionInvalidationVersionsByClient.get(queryClient)
  if (!map) {
    map = new Map()
    runtimeProjectionInvalidationVersionsByClient.set(queryClient, map)
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

export function getRepoRuntimeProjectionInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): number {
  return (
    runtimeProjectionInvalidationVersionMap(queryClient).get(
      runtimeProjectionInvalidationKey(repoRoot, workspaceRuntimeId),
    ) ?? 0
  )
}

function bumpRepoRuntimeProjectionInvalidationVersion(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): void {
  const map = runtimeProjectionInvalidationVersionMap(queryClient)
  const key = runtimeProjectionInvalidationKey(repoRoot, workspaceRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

function markRepoProjectionFetchStarted(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): number {
  const version = getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  repoProjectionFetchInvalidationVersionMap(queryClient).set(
    repoProjectionFetchVersionKey(repoRoot, workspaceRuntimeId, branch, mode),
    version,
  )
  return version
}

function isStaleRepoRuntimeReadError(err: unknown): boolean {
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

export function markRepoRuntimeProjectionInvalidated(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  bumpRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
}

function invalidateActiveRepoQueryKeys(queryClient: QueryClient, queryKeys: ReadonlyArray<readonly unknown[]>): void {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'active' }, { cancelRefetch: false })
  }
}

function invalidateActiveRepoRuntimeProjectionQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
  options: { excludeProjectionQueryKey?: readonly unknown[] } = {},
): void {
  const excludedProjectionHash = options.excludeProjectionQueryKey ? hashKey(options.excludeProjectionQueryKey) : null
  void queryClient.invalidateQueries(
    {
      queryKey: repoProjectionQueryPrefix(repoRoot, workspaceRuntimeId),
      refetchType: 'active',
      predicate: excludedProjectionHash ? (query) => query.queryHash !== excludedProjectionHash : undefined,
    },
    { cancelRefetch: false },
  )
  void queryClient.invalidateQueries(
    { queryKey: repoOperationsQueryPrefix(repoRoot, workspaceRuntimeId), refetchType: 'active' },
    { cancelRefetch: false },
  )
  void queryClient.invalidateQueries(
    { queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId), exact: true, refetchType: 'active' },
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

function repoLogQueryKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  count: number,
  skip: number,
) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'log', branch, count, skip] as const
}

function repoRemoteBranchesQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'remote-branches'] as const
}

export function repoProjectionQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  const requestedBranch = normalizeProjectionBranch(branch)
  const requestedMode = normalizeProjectionMode(mode)
  const placeholderData = getRepoProjectionPlaceholderData(repoRoot, workspaceRuntimeId, branch, mode)
  return queryOptions({
    queryKey: repoProjectionQueryKey(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode),
    queryFn: ({ signal, client }) =>
      fetchRepoProjectionReadModel(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    placeholderData,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

async function fetchRepoProjectionReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<WorkspaceRuntimeProjection> {
  const startedVersion = markRepoProjectionFetchStarted(repoRoot, workspaceRuntimeId, branch, mode, queryClient)
  const projection = await getRepoProjection(repoRoot, workspaceRuntimeId, branch, { mode }, signal)
  signal.throwIfAborted()
  if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return projection
}

export function repoServerOperationActive(operation: Pick<RepoServerOperationState, 'phase'>): boolean {
  return operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'cancelling'
}

export function getRepoProjectionPlaceholderData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspaceRuntimeProjection | undefined {
  const requestedBranch = branch || null
  const requestedMode = mode ?? 'full'
  const cached = findRepoProjectionPlaceholderSource(
    repoRoot,
    workspaceRuntimeId,
    requestedBranch,
    requestedMode,
    queryClient,
  )
  if (!cached?.snapshot) return undefined
  const operations = getRepoOperationsQueryData(repoRoot, workspaceRuntimeId, queryClient) ?? cached.operations
  return {
    snapshot: cached.snapshot,
    pullRequests: null,
    operations,
    requested: {
      branch: requestedBranch,
      pullRequestMode: requestedMode,
    },
    loadedAt: 0,
  }
}

export function repoWorktreeStatusQueryOptions(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return queryOptions({
    queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

async function fetchRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoWorktreeStatusSnapshot> {
  const startedVersion = getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  let snapshot: RepoWorktreeStatusSnapshot
  try {
    snapshot = await getRepoWorktreeStatus(repoRoot, workspaceRuntimeId, signal)
  } catch (err) {
    if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
      throw new StaleRepoRuntimeReadError()
    }
    throw err
  }
  signal.throwIfAborted()
  if (snapshot.workspaceRuntimeId !== workspaceRuntimeId) throw new MismatchedRepoRuntimeReadError()
  if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return snapshot
}

function findRepoProjectionPlaceholderSource(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): WorkspaceRuntimeProjection | undefined {
  const candidates = queryClient
    .getQueriesData<WorkspaceRuntimeProjection>({ queryKey: repoProjectionQueryPrefix(repoRoot, workspaceRuntimeId) })
    .map(([, projection]) => projection)
    .filter((projection): projection is WorkspaceRuntimeProjection => !!projection?.snapshot)
  candidates.sort(
    (a, b) => repoProjectionPlaceholderRank(a, branch, mode) - repoProjectionPlaceholderRank(b, branch, mode),
  )
  return candidates[0]
}

function repoProjectionPlaceholderRank(
  projection: WorkspaceRuntimeProjection,
  branch: string | null,
  mode: PullRequestFetchMode,
): number {
  const requested = projection.requested
  if (requested.branch === branch && requested.pullRequestMode === mode) return 0
  if (requested.branch === null && requested.pullRequestMode === mode) return 1
  if (requested.branch === null && requested.pullRequestMode === 'full') return 2
  if (requested.branch === null) return 3
  if (requested.pullRequestMode === mode) return 4
  return 5
}

function repoLogQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return queryOptions({
    queryKey: repoLogQueryKey(repoRoot, workspaceRuntimeId, branch, count, skip),
    queryFn: ({ signal }) => getRepoLog(repoRoot, workspaceRuntimeId, branch, { count, skip, signal }),
    enabled: options.enabled,
  })
}

function repoRemoteBranchesQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return queryOptions({
    queryKey: repoRemoteBranchesQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal }) => getRepoRemoteBranches(repoRoot, workspaceRuntimeId, signal),
    enabled: options.enabled,
  })
}

export function repoOperationsQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  return queryOptions({
    queryKey: repoOperationsQueryKey(repoRoot, workspaceRuntimeId, includeSettled),
    queryFn: ({ signal, client }) =>
      fetchRepoOperationsReadModel(repoRoot, workspaceRuntimeId, includeSettled, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    enabled: options.enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

async function fetchRepoOperationsReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  includeSettled: boolean,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoOperationsSnapshot> {
  const startedVersion = getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)
  const operations = await getRepoOperations(repoRoot, workspaceRuntimeId, { includeSettled, signal })
  signal.throwIfAborted()
  if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, workspaceRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return operations
}

export function useRepoProjectionReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  const requestedBranch = normalizeProjectionBranch(branch)
  const requestedMode = normalizeProjectionMode(mode)
  const query = useQuery({
    queryKey: [
      'repo-data',
      repoRoot,
      workspaceRuntimeId,
      'projection',
      { branch: requestedBranch, mode: requestedMode },
    ] as const,
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) =>
            fetchRepoProjectionReadModel(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    placeholderData: repoRoot
      ? getRepoProjectionPlaceholderData(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode)
      : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: active,
    subscribed: active,
  })
  return query
}

export function useRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  return useQuery({
    queryKey: ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-status'] as const,
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: active,
    subscribed: active,
  })
}

export function useRepoLogQuery(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  return useQuery(repoLogQueryOptions(repoRoot, workspaceRuntimeId, branch, options))
}

export function useRepoRemoteBranchesQuery(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery(repoRemoteBranchesQueryOptions(repoRoot, workspaceRuntimeId, options))
}

export function useRepoOperationsReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  const enabled = options.enabled !== false && repoRoot !== null
  const query = useQuery({
    queryKey: ['repo-data', repoRoot, workspaceRuntimeId, 'operations', { includeSettled }] as const,
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) =>
            fetchRepoOperationsReadModel(repoRoot, workspaceRuntimeId, includeSettled, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
    subscribed: enabled,
  })
  useEffect(() => {
    if (!enabled || !repoRoot || !query.data) return
    if (!includeSettled) updateRepoProjectionOperationsQueryData(repoRoot, workspaceRuntimeId, query.data)
  }, [enabled, includeSettled, query.data, workspaceRuntimeId, repoRoot])
  return query
}

export function getRepoOperationsQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoOperationsSnapshot | undefined {
  return queryClient.getQueryData<RepoOperationsSnapshot>(repoOperationsQueryKey(repoRoot, workspaceRuntimeId, false))
}

export function setRepoOperationsQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  includeSettled: boolean,
  operations: RepoOperationsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoOperationsQueryKey(repoRoot, workspaceRuntimeId, includeSettled), operations)
  if (!includeSettled) updateRepoProjectionOperationsQueryData(repoRoot, workspaceRuntimeId, operations, queryClient)
}

function updateRepoProjectionOperationsQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  operations: RepoOperationsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const projectionQueries = queryClient
    .getQueryCache()
    .findAll({ queryKey: repoProjectionQueryPrefix(repoRoot, workspaceRuntimeId) })
  for (const query of projectionQueries) {
    if (query.state.isInvalidated) continue
    queryClient.setQueryData<WorkspaceRuntimeProjection>(query.queryKey, (current) =>
      current ? { ...current, operations } : current,
    )
  }
}

export function getRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspaceRuntimeProjection | undefined {
  return queryClient.getQueryData<WorkspaceRuntimeProjection>(
    repoProjectionQueryKey(repoRoot, workspaceRuntimeId, branch, mode),
  )
}

export function getRepoWorktreeStatusQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoWorktreeStatusSnapshot | undefined {
  return queryClient.getQueryData<RepoWorktreeStatusSnapshot>(repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId))
}

export function setRepoWorktreeStatusQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: RepoWorktreeStatusSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  if (snapshot.workspaceRuntimeId !== workspaceRuntimeId) return
  queryClient.setQueryData(repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId), snapshot)
}

export function setRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  projection: WorkspaceRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoProjectionQueryKey(repoRoot, workspaceRuntimeId, branch, mode), projection)
  setRepoOperationsQueryData(repoRoot, workspaceRuntimeId, false, projection.operations, queryClient)
}

export function seedRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  projection: WorkspaceRuntimeProjection | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  // Stub leases (non-active repos at cold start) carry `projection: null`.
  // Nothing to seed — the lazy restore will fill the cache when the user
  // navigates to the repo.
  if (!projection) return
  // Cache/session restore seed data is a UI placeholder, not an authoritative
  // server read, so do not seed the active operations cache here.
  queryClient.setQueryData(
    repoProjectionQueryKey(
      repoRoot,
      workspaceRuntimeId,
      projection.requested.branch,
      projection.requested.pullRequestMode,
    ),
    projection,
  )
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
  markRepoRuntimeProjectionInvalidated(input.repoRoot, input.workspaceRuntimeId, input.queryClient)
  invalidateActiveRepoRuntimeProjectionQueries(input.repoRoot, input.workspaceRuntimeId, input.queryClient, {
    excludeProjectionQueryKey: input.queryKey,
  })
  await invalidateExactRepoProjectionQuery(input.queryClient, input.queryKey)
}

async function fetchRepoProjectionReadModelOnce(
  input: RepoProjectionRefreshReadInput,
): Promise<WorkspaceRuntimeProjection> {
  const projectionQueryOptions = repoProjectionQueryOptions(
    input.repoRoot,
    input.workspaceRuntimeId,
    input.branch,
    input.mode,
  )
  const hasSharedFetchInProgress = hasRepoProjectionFetchInProgress(input.queryClient, input.queryKey)
  const projectionPromise = input.queryClient.fetchQuery({
    ...projectionQueryOptions,
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
      getRepoRuntimeProjectionInvalidationVersion(input.repoRoot, input.workspaceRuntimeId, input.queryClient) &&
    input.queryClient.getQueryState(input.queryKey)?.isInvalidated !== true
  )
}

async function fetchRepoProjectionReadModelUntilCurrent(
  input: RepoProjectionRefreshReadInput,
): Promise<WorkspaceRuntimeProjection> {
  for (;;) {
    let projection: WorkspaceRuntimeProjection
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
): Promise<WorkspaceRuntimeProjection> {
  options.signal?.throwIfAborted()
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const requestedBranch = normalizeProjectionBranch(branch)
  const requestedMode = normalizeProjectionMode(mode)
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
  setRepoOperationsQueryData(repoRoot, workspaceRuntimeId, false, projection.operations, queryClient)
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
          ...repoWorktreeStatusQueryOptions(repoRoot, workspaceRuntimeId),
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

export function invalidateRepoDataQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  markRepoRuntimeProjectionInvalidated(repoRoot, workspaceRuntimeId, queryClient)
  invalidateActiveRepoQueryKeys(queryClient, [repoDataQueryKey(repoRoot, workspaceRuntimeId)])
}

export function invalidateRepoRuntimeProjectionQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  markRepoRuntimeProjectionInvalidated(repoRoot, workspaceRuntimeId, queryClient)
  invalidateActiveRepoRuntimeProjectionQueries(repoRoot, workspaceRuntimeId, queryClient)
}
