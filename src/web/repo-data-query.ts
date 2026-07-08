import { useEffect } from 'react'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoLog, getRepoOperations, getRepoProjection, getRepoRemoteBranches } from '#/web/repo-client.ts'
import type { RepoOperationsSnapshot, RepoRuntimeProjection, RepoServerOperationState } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode } from '#/shared/git-types.ts'

interface CoalescedRepoRefetch {
  inFlight: Promise<void> | null
  rerunRequested: boolean
}

const coalescedRepoRefetchesByClient = new WeakMap<QueryClient, Map<string, CoalescedRepoRefetch>>()

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
    { branch: branch || null, mode: mode ?? 'full' },
  ] as const
}

export interface ParsedRepoProjectionQueryKey {
  repoRoot: string
  repoRuntimeId: string
}

export function parseRepoProjectionQueryKey(queryKey: readonly unknown[]): ParsedRepoProjectionQueryKey | null {
  if (queryKey.length < 5) return null
  if (queryKey[0] !== 'repo-data') return null
  if (queryKey[3] !== 'projection') return null
  const repoRoot = queryKey[1]
  const repoRuntimeId = queryKey[2]
  if (typeof repoRoot !== 'string' || typeof repoRuntimeId !== 'string') return null
  return { repoRoot, repoRuntimeId }
}

function repoProjectionQueryKeysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== 5 || b.length !== 5) return false
  if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) return false
  const aOptions = a[4]
  const bOptions = b[4]
  if (!aOptions || !bOptions || typeof aOptions !== 'object' || typeof bOptions !== 'object') return false
  const aProjection = aOptions as { branch?: unknown; mode?: unknown }
  const bProjection = bOptions as { branch?: unknown; mode?: unknown }
  return aProjection.branch === bProjection.branch && aProjection.mode === bProjection.mode
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

function coalescedRepoRefetchMap(queryClient: QueryClient): Map<string, CoalescedRepoRefetch> {
  let map = coalescedRepoRefetchesByClient.get(queryClient)
  if (!map) {
    map = new Map()
    coalescedRepoRefetchesByClient.set(queryClient, map)
  }
  return map
}

function markRepoQueryKeysInvalidated(queryClient: QueryClient, queryKeys: ReadonlyArray<readonly unknown[]>): void {
  for (const queryKey of queryKeys) {
    void queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
  }
}

async function refetchActiveRepoQueryKeys(
  queryClient: QueryClient,
  queryKeys: ReadonlyArray<readonly unknown[]>,
): Promise<void> {
  await Promise.all(
    queryKeys.map(async (queryKey) => {
      await queryClient.refetchQueries({ queryKey, type: 'active' }, { cancelRefetch: false })
    }),
  )
}

function activeRepoQueryKeysFetching(
  queryClient: QueryClient,
  queryKeys: ReadonlyArray<readonly unknown[]>,
): boolean {
  return queryKeys.some((queryKey) =>
    queryClient
      .getQueryCache()
      .findAll({ queryKey, type: 'active' })
      .some((query) => query.state.fetchStatus === 'fetching'),
  )
}

function requestCoalescedActiveRepoRefetch(
  queryClient: QueryClient,
  key: string,
  queryKeys: ReadonlyArray<readonly unknown[]>,
): void {
  const wasAlreadyFetching = activeRepoQueryKeysFetching(queryClient, queryKeys)
  markRepoQueryKeysInvalidated(queryClient, queryKeys)
  const map = coalescedRepoRefetchMap(queryClient)
  const runtime = map.get(key) ?? { inFlight: null, rerunRequested: false }
  map.set(key, runtime)
  if (wasAlreadyFetching) runtime.rerunRequested = true
  if (runtime.inFlight) {
    runtime.rerunRequested = true
    return
  }

  const run = () => {
    runtime.inFlight = refetchActiveRepoQueryKeys(queryClient, queryKeys).finally(() => {
      runtime.inFlight = null
      if (runtime.rerunRequested) {
        runtime.rerunRequested = false
        markRepoQueryKeysInvalidated(queryClient, queryKeys)
        run()
        return
      }
      if (map.get(key) === runtime) map.delete(key)
    })
  }

  run()
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
  const placeholderData = getRepoProjectionPlaceholderData(repoRoot, repoRuntimeId, branch, mode)
  return queryOptions({
    queryKey: repoProjectionQueryKey(repoRoot, repoRuntimeId, branch, mode),
    queryFn: ({ signal }) => getRepoProjection(repoRoot, branch, { mode }, signal),
    placeholderData,
    staleTime: Number.POSITIVE_INFINITY,
  })
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
    queryFn: ({ signal }) => getRepoOperations(repoRoot, { includeSettled, signal }),
    enabled: options.enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
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

export async function refreshRepoProjectionReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<RepoRuntimeProjection> {
  options.signal?.throwIfAborted()
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const queryOptions = repoProjectionQueryOptions(repoRoot, repoRuntimeId, branch, mode)
  await queryClient.cancelQueries({ queryKey: queryOptions.queryKey, exact: true })
  await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: 'none' })
  options.signal?.throwIfAborted()
  let projection: RepoRuntimeProjection
  for (;;) {
    let invalidatedDuringFetch = false
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return
      if (event.action.type !== 'invalidate') return
      if (repoProjectionQueryKeysEqual(event.query.queryKey, queryOptions.queryKey)) invalidatedDuringFetch = true
    })
    try {
      projection = await queryClient.fetchQuery({
        ...queryOptions,
        staleTime: 0,
        queryFn: ({ signal }) =>
          getRepoProjection(
            repoRoot,
            branch,
            { mode },
            options.signal ? abortSignalAny([signal, options.signal]) : signal,
          ),
      })
    } finally {
      unsubscribe()
    }
    options.signal?.throwIfAborted()
    if (!invalidatedDuringFetch && queryClient.getQueryState(queryOptions.queryKey)?.isInvalidated !== true) break
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey, exact: true, refetchType: 'none' })
    options.signal?.throwIfAborted()
  }
  setRepoOperationsQueryData(repoRoot, repoRuntimeId, false, projection.operations, queryClient)
  return projection
}

export function invalidateRepoDataQueries(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  requestCoalescedActiveRepoRefetch(queryClient, `repo-data:${repoRoot}\0${repoRuntimeId}`, [
    repoDataQueryKey(repoRoot, repoRuntimeId),
  ])
}

export function invalidateRepoRuntimeProjectionQueries(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  requestCoalescedActiveRepoRefetch(queryClient, `repo-runtime:${repoRoot}\0${repoRuntimeId}`, [
    repoProjectionQueryPrefix(repoRoot, repoRuntimeId),
    repoOperationsQueryPrefix(repoRoot, repoRuntimeId),
  ])
}
