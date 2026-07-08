import { useEffect } from 'react'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { getRepoLog, getRepoOperations, getRepoProjection, getRepoRemoteBranches } from '#/web/repo-client.ts'
import type { RepoOperationsSnapshot, RepoRuntimeProjection, RepoServerOperationState } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode } from '#/shared/git-types.ts'

export function repoProjectionQueryKey(
  repoRoot: string,
  repoInstanceId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  return [
    'repo-data',
    repoRoot,
    repoInstanceId,
    'projection',
    { branch: branch || null, mode: mode ?? 'full' },
  ] as const
}

export function repoOperationsQueryKey(repoRoot: string, repoInstanceId: string, includeSettled = false) {
  return ['repo-data', repoRoot, repoInstanceId, 'operations', { includeSettled }] as const
}

export function repoDataQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId] as const
}

function repoProjectionQueryPrefix(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'projection'] as const
}

function repoOperationsQueryPrefix(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'operations'] as const
}

function repoLogQueryKey(repoRoot: string, repoInstanceId: string, branch: string, count: number, skip: number) {
  return ['repo-data', repoRoot, repoInstanceId, 'log', branch, count, skip] as const
}

function repoRemoteBranchesQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'remote-branches'] as const
}

export function repoProjectionQueryOptions(
  repoRoot: string,
  repoInstanceId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  const placeholderData = getRepoProjectionPlaceholderData(repoRoot, repoInstanceId, branch, mode)
  return queryOptions({
    queryKey: repoProjectionQueryKey(repoRoot, repoInstanceId, branch, mode),
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
  repoInstanceId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoRuntimeProjection | undefined {
  const requestedBranch = branch || null
  const requestedMode = mode ?? 'full'
  const cached = findRepoProjectionPlaceholderSource(
    repoRoot,
    repoInstanceId,
    requestedBranch,
    requestedMode,
    queryClient,
  )
  if (!cached?.snapshot) return undefined
  const operations = getRepoOperationsQueryData(repoRoot, repoInstanceId, queryClient) ?? cached.operations
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
  repoInstanceId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): RepoRuntimeProjection | undefined {
  const candidates = queryClient
    .getQueriesData<RepoRuntimeProjection>({ queryKey: repoProjectionQueryPrefix(repoRoot, repoInstanceId) })
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
  repoInstanceId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return queryOptions({
    queryKey: repoLogQueryKey(repoRoot, repoInstanceId, branch, count, skip),
    queryFn: ({ signal }) => getRepoLog(repoRoot, branch, { count, skip, signal }),
    enabled: options.enabled,
  })
}

function repoRemoteBranchesQueryOptions(repoRoot: string, repoInstanceId: string, options: { enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: repoRemoteBranchesQueryKey(repoRoot, repoInstanceId),
    queryFn: ({ signal }) => getRepoRemoteBranches(repoRoot, signal),
    enabled: options.enabled,
  })
}

export function repoOperationsQueryOptions(
  repoRoot: string,
  repoInstanceId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  return queryOptions({
    queryKey: repoOperationsQueryKey(repoRoot, repoInstanceId, includeSettled),
    queryFn: ({ signal }) => getRepoOperations(repoRoot, { includeSettled, signal }),
    enabled: options.enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useRepoProjectionReadModel(
  repoRoot: string,
  repoInstanceId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  const query = useQuery({
    ...repoProjectionQueryOptions(repoRoot, repoInstanceId, branch, mode),
    enabled,
    subscribed: enabled,
  })
  useEffect(() => {
    if (!enabled || !query.data || query.isPlaceholderData) return
    setRepoProjectionQueryData(repoRoot, repoInstanceId, branch, mode, query.data)
  }, [branch, enabled, mode, query.data, query.isPlaceholderData, repoInstanceId, repoRoot])
  return query
}

export function useRepoLogQuery(
  repoRoot: string,
  repoInstanceId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  return useQuery(repoLogQueryOptions(repoRoot, repoInstanceId, branch, options))
}

export function useRepoRemoteBranchesQuery(
  repoRoot: string,
  repoInstanceId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery(repoRemoteBranchesQueryOptions(repoRoot, repoInstanceId, options))
}

export function useRepoOperationsReadModel(
  repoRoot: string,
  repoInstanceId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  const enabled = options.enabled !== false
  const query = useQuery({
    ...repoOperationsQueryOptions(repoRoot, repoInstanceId, { includeSettled, enabled }),
    subscribed: enabled,
  })
  useEffect(() => {
    if (!enabled || !query.data) return
    setRepoOperationsQueryData(repoRoot, repoInstanceId, includeSettled, query.data)
  }, [enabled, includeSettled, query.data, repoInstanceId, repoRoot])
  return query
}

export function getRepoOperationsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoOperationsSnapshot | undefined {
  return queryClient.getQueryData<RepoOperationsSnapshot>(repoOperationsQueryKey(repoRoot, repoInstanceId, false))
}

export function setRepoOperationsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  includeSettled: boolean,
  operations: RepoOperationsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoOperationsQueryKey(repoRoot, repoInstanceId, includeSettled), operations)
  if (!includeSettled) {
    queryClient.setQueriesData<RepoRuntimeProjection>(
      { queryKey: repoProjectionQueryPrefix(repoRoot, repoInstanceId) },
      (current) => (current ? { ...current, operations } : current),
    )
  }
}

export function getRepoProjectionQueryData(
  repoRoot: string,
  repoInstanceId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoRuntimeProjection | undefined {
  return queryClient.getQueryData<RepoRuntimeProjection>(repoProjectionQueryKey(repoRoot, repoInstanceId, branch, mode))
}

export function setRepoProjectionQueryData(
  repoRoot: string,
  repoInstanceId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  projection: RepoRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoProjectionQueryKey(repoRoot, repoInstanceId, branch, mode), projection)
  setRepoOperationsQueryData(repoRoot, repoInstanceId, false, projection.operations, queryClient)
}

export function seedRepoProjectionQueryData(
  repoRoot: string,
  repoInstanceId: string,
  projection: RepoRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  // Cache/session restore seed data is a UI placeholder, not an authoritative
  // server read, so do not seed the active operations cache here.
  queryClient.setQueryData(
    repoProjectionQueryKey(repoRoot, repoInstanceId, projection.requested.branch, projection.requested.pullRequestMode),
    projection,
  )
}

export function invalidateRepoDataQueries(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void queryClient.invalidateQueries({ queryKey: repoDataQueryKey(repoRoot, repoInstanceId) })
}

export function invalidateRepoRuntimeProjectionQueries(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void queryClient.invalidateQueries({ queryKey: repoProjectionQueryPrefix(repoRoot, repoInstanceId) })
  void queryClient.invalidateQueries({ queryKey: repoOperationsQueryPrefix(repoRoot, repoInstanceId) })
}
