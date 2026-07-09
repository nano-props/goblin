import { useEffect } from 'react'
import { hashKey, queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoLog, getRepoOperations, getRepoProjection, getRepoRemoteBranches } from '#/web/repo-client.ts'
import type { RepoOperationsSnapshot, RepoRuntimeProjection, RepoServerOperationState } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode } from '#/shared/git-types.ts'

class StaleRepoRuntimeReadError extends Error {
  constructor() {
    super('Stale repo runtime read')
    this.name = 'StaleRepoRuntimeReadError'
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
  repoRoot: string,
  repoRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  return [
    'repo-data',
    repoRoot,
    repoRuntimeId,
    'projection',
    { branch: normalizeProjectionBranch(branch), mode: normalizeProjectionMode(mode) },
  ] as const
}

export interface ParsedRepoProjectionQueryKey {
  repoRoot: string
  repoRuntimeId: string
  branch: string | null
  mode: PullRequestFetchMode
}

export function parseRepoProjectionQueryKey(queryKey: readonly unknown[]): ParsedRepoProjectionQueryKey | null {
  if (queryKey.length !== 5) return null
  if (queryKey[0] !== 'repo-data') return null
  if (queryKey[3] !== 'projection') return null
  const repoRoot = queryKey[1]
  const repoRuntimeId = queryKey[2]
  if (typeof repoRoot !== 'string' || typeof repoRuntimeId !== 'string') return null
  const options = queryKey[4]
  if (!options || typeof options !== 'object') return null
  const projection = options as { branch?: unknown; mode?: unknown }
  const branch = typeof projection.branch === 'string' && projection.branch.length > 0 ? projection.branch : null
  const mode = projection.mode === 'summary' ? 'summary' : 'full'
  return { repoRoot, repoRuntimeId, branch, mode }
}

export function repoOperationsQueryKey(repoRoot: string, repoRuntimeId: string, includeSettled = false) {
  return ['repo-data', repoRoot, repoRuntimeId, 'operations', { includeSettled }] as const
}

export function repoDataQueryKey(repoRoot: string, repoRuntimeId: string) {
  return ['repo-data', repoRoot, repoRuntimeId] as const
}

function repoProjectionQueryPrefix(repoRoot: string, repoRuntimeId: string) {
  return ['repo-data', repoRoot, repoRuntimeId, 'projection'] as const
}

function repoOperationsQueryPrefix(repoRoot: string, repoRuntimeId: string) {
  return ['repo-data', repoRoot, repoRuntimeId, 'operations'] as const
}

function runtimeProjectionInvalidationKey(repoRoot: string, repoRuntimeId: string): string {
  return `${repoRoot}\0${repoRuntimeId}`
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
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
): string {
  return `${repoRoot}\0${repoRuntimeId}\0${branch ?? ''}\0${mode}`
}

export function getRepoRuntimeProjectionInvalidationVersion(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): number {
  return runtimeProjectionInvalidationVersionMap(queryClient).get(runtimeProjectionInvalidationKey(repoRoot, repoRuntimeId)) ?? 0
}

function bumpRepoRuntimeProjectionInvalidationVersion(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient,
): void {
  const map = runtimeProjectionInvalidationVersionMap(queryClient)
  const key = runtimeProjectionInvalidationKey(repoRoot, repoRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

function markRepoProjectionFetchStarted(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): number {
  const version = getRepoRuntimeProjectionInvalidationVersion(repoRoot, repoRuntimeId, queryClient)
  repoProjectionFetchInvalidationVersionMap(queryClient).set(
    repoProjectionFetchVersionKey(repoRoot, repoRuntimeId, branch, mode),
    version,
  )
  return version
}

function isStaleRepoRuntimeReadError(err: unknown): boolean {
  return err instanceof StaleRepoRuntimeReadError
}

export function getRepoProjectionFetchInvalidationVersion(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): number | null {
  return (
    repoProjectionFetchInvalidationVersionMap(queryClient).get(
      repoProjectionFetchVersionKey(repoRoot, repoRuntimeId, branch, mode),
    ) ?? null
  )
}

export function clearRepoProjectionFetchInvalidationVersion(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  repoProjectionFetchInvalidationVersionMap(queryClient).delete(
    repoProjectionFetchVersionKey(repoRoot, repoRuntimeId, branch, mode),
  )
}

export function markRepoRuntimeProjectionInvalidated(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  bumpRepoRuntimeProjectionInvalidationVersion(repoRoot, repoRuntimeId, queryClient)
}

function invalidateActiveRepoQueryKeys(queryClient: QueryClient, queryKeys: ReadonlyArray<readonly unknown[]>): void {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'active' }, { cancelRefetch: false })
  }
}

function invalidateActiveRepoRuntimeProjectionQueries(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient,
  options: { excludeProjectionQueryKey?: readonly unknown[] } = {},
): void {
  const excludedProjectionHash = options.excludeProjectionQueryKey
    ? hashKey(options.excludeProjectionQueryKey)
    : null
  void queryClient.invalidateQueries(
    {
      queryKey: repoProjectionQueryPrefix(repoRoot, repoRuntimeId),
      refetchType: 'active',
      predicate: excludedProjectionHash ? (query) => query.queryHash !== excludedProjectionHash : undefined,
    },
    { cancelRefetch: false },
  )
  void queryClient.invalidateQueries(
    { queryKey: repoOperationsQueryPrefix(repoRoot, repoRuntimeId), refetchType: 'active' },
    { cancelRefetch: false },
  )
}

async function invalidateExactRepoProjectionQuery(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof repoProjectionQueryKey>,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
}

function repoProjectionFetchAlreadyActive(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof repoProjectionQueryKey>,
): boolean {
  const status = queryClient.getQueryState(queryKey)?.fetchStatus
  return status === 'fetching' || status === 'paused'
}

function abortSignalAny(signals: AbortSignal[]): AbortSignal {
  const aborted = signals.find((signal) => signal.aborted)
  if (aborted) return aborted
  const ctrl = new AbortController()
  const abort = (event: Event) => {
    const signal = event.target as AbortSignal
    for (const current of signals) current.removeEventListener('abort', abort)
    ctrl.abort(signal.reason)
  }
  for (const signal of signals) signal.addEventListener('abort', abort, { once: true })
  return ctrl.signal
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

function repoLogQueryKey(repoRoot: string, repoRuntimeId: string, branch: string, count: number, skip: number) {
  return ['repo-data', repoRoot, repoRuntimeId, 'log', branch, count, skip] as const
}

function repoRemoteBranchesQueryKey(repoRoot: string, repoRuntimeId: string) {
  return ['repo-data', repoRoot, repoRuntimeId, 'remote-branches'] as const
}

export function repoProjectionQueryOptions(
  repoRoot: string,
  repoRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  const requestedBranch = normalizeProjectionBranch(branch)
  const requestedMode = normalizeProjectionMode(mode)
  const placeholderData = getRepoProjectionPlaceholderData(repoRoot, repoRuntimeId, branch, mode)
  return queryOptions({
    queryKey: repoProjectionQueryKey(repoRoot, repoRuntimeId, requestedBranch, requestedMode),
    queryFn: ({ signal, client }) =>
      fetchRepoProjectionReadModel(repoRoot, repoRuntimeId, requestedBranch, requestedMode, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    placeholderData,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

async function fetchRepoProjectionReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoRuntimeProjection> {
  const startedVersion = markRepoProjectionFetchStarted(repoRoot, repoRuntimeId, branch, mode, queryClient)
  const projection = await getRepoProjection(repoRoot, branch, { mode }, signal)
  signal.throwIfAborted()
  if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, repoRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return projection
}

export function repoServerOperationActive(operation: Pick<RepoServerOperationState, 'phase'>): boolean {
  return operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'cancelling'
}

export function getRepoProjectionPlaceholderData(
  repoRoot: string,
  repoRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoRuntimeProjection | undefined {
  const requestedBranch = branch || null
  const requestedMode = mode ?? 'full'
  const cached = findRepoProjectionPlaceholderSource(
    repoRoot,
    repoRuntimeId,
    requestedBranch,
    requestedMode,
    queryClient,
  )
  if (!cached?.snapshot) return undefined
  const operations = getRepoOperationsQueryData(repoRoot, repoRuntimeId, queryClient) ?? cached.operations
  return {
    snapshot: cached.snapshot,
    status: cached.status,
    pullRequests: null,
    operations,
    requested: {
      branch: requestedBranch,
      pullRequestMode: requestedMode,
    },
    loadedAt: 0,
  }
}

function findRepoProjectionPlaceholderSource(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): RepoRuntimeProjection | undefined {
  const candidates = queryClient
    .getQueriesData<RepoRuntimeProjection>({ queryKey: repoProjectionQueryPrefix(repoRoot, repoRuntimeId) })
    .map(([_key, projection]) => projection)
    .filter((projection): projection is RepoRuntimeProjection => !!projection?.snapshot)
  candidates.sort(
    (a, b) => repoProjectionPlaceholderRank(a, branch, mode) - repoProjectionPlaceholderRank(b, branch, mode),
  )
  return candidates[0]
}

function repoProjectionPlaceholderRank(
  projection: RepoRuntimeProjection,
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
  repoRoot: string,
  repoRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return queryOptions({
    queryKey: repoLogQueryKey(repoRoot, repoRuntimeId, branch, count, skip),
    queryFn: ({ signal }) => getRepoLog(repoRoot, branch, { count, skip, signal }),
    enabled: options.enabled,
  })
}

function repoRemoteBranchesQueryOptions(repoRoot: string, repoRuntimeId: string, options: { enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: repoRemoteBranchesQueryKey(repoRoot, repoRuntimeId),
    queryFn: ({ signal }) => getRepoRemoteBranches(repoRoot, signal),
    enabled: options.enabled,
  })
}

export function repoOperationsQueryOptions(
  repoRoot: string,
  repoRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  return queryOptions({
    queryKey: repoOperationsQueryKey(repoRoot, repoRuntimeId, includeSettled),
    queryFn: ({ signal, client }) => fetchRepoOperationsReadModel(repoRoot, repoRuntimeId, includeSettled, signal, client),
    retry: (_failureCount, err) => isStaleRepoRuntimeReadError(err),
    retryDelay: 0,
    enabled: options.enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

async function fetchRepoOperationsReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  includeSettled: boolean,
  signal: AbortSignal,
  queryClient: QueryClient,
): Promise<RepoOperationsSnapshot> {
  const startedVersion = getRepoRuntimeProjectionInvalidationVersion(repoRoot, repoRuntimeId, queryClient)
  const operations = await getRepoOperations(repoRoot, { includeSettled, signal })
  signal.throwIfAborted()
  if (startedVersion < getRepoRuntimeProjectionInvalidationVersion(repoRoot, repoRuntimeId, queryClient)) {
    throw new StaleRepoRuntimeReadError()
  }
  return operations
}

export function useRepoProjectionReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  const query = useQuery({
    ...repoProjectionQueryOptions(repoRoot, repoRuntimeId, branch, mode),
    enabled,
    subscribed: enabled,
  })
  return query
}

export function useRepoLogQuery(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  return useQuery(repoLogQueryOptions(repoRoot, repoRuntimeId, branch, options))
}

export function useRepoRemoteBranchesQuery(
  repoRoot: string,
  repoRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery(repoRemoteBranchesQueryOptions(repoRoot, repoRuntimeId, options))
}

export function useRepoOperationsReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  const enabled = options.enabled !== false
  const query = useQuery({
    ...repoOperationsQueryOptions(repoRoot, repoRuntimeId, { includeSettled, enabled }),
    subscribed: enabled,
  })
  useEffect(() => {
    if (!enabled || !query.data) return
    if (!includeSettled) updateRepoProjectionOperationsQueryData(repoRoot, repoRuntimeId, query.data)
  }, [enabled, includeSettled, query.data, repoRuntimeId, repoRoot])
  return query
}

export function getRepoOperationsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoOperationsSnapshot | undefined {
  return queryClient.getQueryData<RepoOperationsSnapshot>(repoOperationsQueryKey(repoRoot, repoRuntimeId, false))
}

export function setRepoOperationsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  includeSettled: boolean,
  operations: RepoOperationsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoOperationsQueryKey(repoRoot, repoRuntimeId, includeSettled), operations)
  if (!includeSettled) updateRepoProjectionOperationsQueryData(repoRoot, repoRuntimeId, operations, queryClient)
}

function updateRepoProjectionOperationsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  operations: RepoOperationsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const projectionQueries = queryClient.getQueryCache().findAll({ queryKey: repoProjectionQueryPrefix(repoRoot, repoRuntimeId) })
  for (const query of projectionQueries) {
    if (query.state.isInvalidated) continue
    queryClient.setQueryData<RepoRuntimeProjection>(query.queryKey, (current) =>
      current ? { ...current, operations } : current,
    )
  }
}

export function getRepoProjectionQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoRuntimeProjection | undefined {
  return queryClient.getQueryData<RepoRuntimeProjection>(repoProjectionQueryKey(repoRoot, repoRuntimeId, branch, mode))
}

export function setRepoProjectionQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  projection: RepoRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoProjectionQueryKey(repoRoot, repoRuntimeId, branch, mode), projection)
  setRepoOperationsQueryData(repoRoot, repoRuntimeId, false, projection.operations, queryClient)
}

export function seedRepoProjectionQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  projection: RepoRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  // Cache/session restore seed data is a UI placeholder, not an authoritative
  // server read, so do not seed the active operations cache here.
  queryClient.setQueryData(
    repoProjectionQueryKey(repoRoot, repoRuntimeId, projection.requested.branch, projection.requested.pullRequestMode),
    projection,
  )
}

interface RepoProjectionRefreshReadInput {
  repoRoot: string
  repoRuntimeId: string
  branch: string | null
  mode: PullRequestFetchMode
  queryClient: QueryClient
  queryKey: ReturnType<typeof repoProjectionQueryKey>
  signal?: AbortSignal
}

async function prepareRepoProjectionReadModelRefresh(input: RepoProjectionRefreshReadInput): Promise<void> {
  markRepoRuntimeProjectionInvalidated(input.repoRoot, input.repoRuntimeId, input.queryClient)
  invalidateActiveRepoRuntimeProjectionQueries(input.repoRoot, input.repoRuntimeId, input.queryClient, {
    excludeProjectionQueryKey: input.queryKey,
  })
  await invalidateExactRepoProjectionQuery(input.queryClient, input.queryKey)
}

async function fetchRepoProjectionReadModelOnce(input: RepoProjectionRefreshReadInput): Promise<RepoRuntimeProjection> {
  const projectionQueryOptions = repoProjectionQueryOptions(input.repoRoot, input.repoRuntimeId, input.branch, input.mode)
  const sharedFetchAlreadyActive = repoProjectionFetchAlreadyActive(input.queryClient, input.queryKey)
  const projectionPromise = input.queryClient.fetchQuery({
    ...projectionQueryOptions,
    staleTime: 0,
    queryFn: ({ signal }) =>
      fetchRepoProjectionReadModel(
        input.repoRoot,
        input.repoRuntimeId,
        input.branch,
        input.mode,
        input.signal && !sharedFetchAlreadyActive ? abortSignalAny([signal, input.signal]) : signal,
        input.queryClient,
      ),
  })
  return await abortablePromise(projectionPromise, input.signal)
}

function repoProjectionReadCurrent(input: RepoProjectionRefreshReadInput): boolean {
  const fetchInvalidationVersion = getRepoProjectionFetchInvalidationVersion(
    input.repoRoot,
    input.repoRuntimeId,
    input.branch,
    input.mode,
    input.queryClient,
  )
  return (
    fetchInvalidationVersion ===
      getRepoRuntimeProjectionInvalidationVersion(input.repoRoot, input.repoRuntimeId, input.queryClient) &&
    input.queryClient.getQueryState(input.queryKey)?.isInvalidated !== true
  )
}

async function fetchRepoProjectionReadModelUntilCurrent(
  input: RepoProjectionRefreshReadInput,
): Promise<RepoRuntimeProjection> {
  for (;;) {
    let projection: RepoRuntimeProjection
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
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<RepoRuntimeProjection> {
  options.signal?.throwIfAborted()
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const requestedBranch = normalizeProjectionBranch(branch)
  const requestedMode = normalizeProjectionMode(mode)
  const queryKey = repoProjectionQueryKey(repoRoot, repoRuntimeId, requestedBranch, requestedMode)
  const refreshReadInput: RepoProjectionRefreshReadInput = {
    repoRoot,
    repoRuntimeId,
    branch: requestedBranch,
    mode: requestedMode,
    queryClient,
    queryKey,
    signal: options.signal,
  }
  await prepareRepoProjectionReadModelRefresh(refreshReadInput)
  options.signal?.throwIfAborted()
  const projection = await fetchRepoProjectionReadModelUntilCurrent(refreshReadInput)
  setRepoOperationsQueryData(repoRoot, repoRuntimeId, false, projection.operations, queryClient)
  return projection
}

export function invalidateRepoDataQueries(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  markRepoRuntimeProjectionInvalidated(repoRoot, repoRuntimeId, queryClient)
  invalidateActiveRepoQueryKeys(queryClient, [
    repoDataQueryKey(repoRoot, repoRuntimeId),
  ])
}

export function invalidateRepoRuntimeProjectionQueries(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  markRepoRuntimeProjectionInvalidated(repoRoot, repoRuntimeId, queryClient)
  invalidateActiveRepoRuntimeProjectionQueries(repoRoot, repoRuntimeId, queryClient)
}
