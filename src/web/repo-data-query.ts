import { useEffect } from 'react'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  getRepoLog,
  getRepoProjection,
  getRepoRemoteBranches,
} from '#/web/repo-client.ts'
import type { RepoOperationsSnapshot, RepoRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode, type WorktreeStatus } from '#/shared/git-types.ts'

const ACTIVE_REPO_OPERATION_REFETCH_INTERVAL_MS = 1_000
const RUNTIME_PROJECTION_REFRESH_DELAYS_MS = [50, 250] as const

export function repoSnapshotQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'snapshot'] as const
}

export function repoStatusQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'status'] as const
}

export function repoProjectionQueryKey(
  repoRoot: string,
  repoInstanceId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  return ['repo-data', repoRoot, repoInstanceId, 'projection', { branch: branch || null, mode: mode ?? 'full' }] as const
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
    refetchInterval: (query) =>
      repoOperationsSnapshotHasActiveOperations(query.state.data?.operations)
        ? ACTIVE_REPO_OPERATION_REFETCH_INTERVAL_MS
        : false,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function repoOperationsSnapshotHasActiveOperations(snapshot: RepoOperationsSnapshot | undefined): boolean {
  return !!snapshot?.operations.some(
    (operation) =>
      operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'cancelling',
  )
}

export function getRepoProjectionPlaceholderData(
  repoRoot: string,
  repoInstanceId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoRuntimeProjection | undefined {
  const snapshot = getRepoSnapshotQueryData(repoRoot, repoInstanceId, queryClient)
  if (!snapshot) return undefined
  const status = getRepoStatusQueryData(repoRoot, repoInstanceId, queryClient) ?? []
  const requestedBranch = branch || null
  const operations = getRepoOperationsQueryData(repoRoot, repoInstanceId, queryClient) ?? { operations: [], loadedAt: 0 }
  return {
    snapshot,
    status,
    pullRequests: null,
    operations,
    requested: {
      branch: requestedBranch,
      pullRequestMode: mode ?? 'full',
    },
    loadedAt: 0,
  }
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

function setRepoSnapshotQueryData(
  repoRoot: string,
  repoInstanceId: string,
  snapshot: RepoSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  setRepoSnapshotQueryDataOnly(repoRoot, repoInstanceId, snapshot, queryClient)
  queryClient.setQueriesData<RepoRuntimeProjection>(
    { queryKey: repoProjectionQueryPrefix(repoRoot, repoInstanceId) },
    (current) => (current ? { ...current, snapshot } : current),
  )
}

function setRepoSnapshotQueryDataOnly(
  repoRoot: string,
  repoInstanceId: string,
  snapshot: RepoSnapshot,
  queryClient: QueryClient,
): void {
  queryClient.setQueryData(repoSnapshotQueryKey(repoRoot, repoInstanceId), snapshot)
}

function getRepoSnapshotQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoSnapshot | undefined {
  return queryClient.getQueryData<RepoSnapshot>(repoSnapshotQueryKey(repoRoot, repoInstanceId))
}

function getRepoStatusQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): WorktreeStatus[] | undefined {
  return queryClient.getQueryData<WorktreeStatus[]>(repoStatusQueryKey(repoRoot, repoInstanceId))
}

function setRepoStatusQueryData(
  repoRoot: string,
  repoInstanceId: string,
  status: WorktreeStatus[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  setRepoStatusQueryDataOnly(repoRoot, repoInstanceId, status, queryClient)
  queryClient.setQueriesData<RepoRuntimeProjection>(
    { queryKey: repoProjectionQueryPrefix(repoRoot, repoInstanceId) },
    (current) => (current ? { ...current, status } : current),
  )
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

function setRepoStatusQueryDataOnly(
  repoRoot: string,
  repoInstanceId: string,
  status: WorktreeStatus[],
  queryClient: QueryClient,
): void {
  queryClient.setQueryData(repoStatusQueryKey(repoRoot, repoInstanceId), status)
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
  if (projection.snapshot) setRepoSnapshotQueryData(repoRoot, repoInstanceId, projection.snapshot, queryClient)
  setRepoStatusQueryData(repoRoot, repoInstanceId, projection.status, queryClient)
  setRepoOperationsQueryData(repoRoot, repoInstanceId, false, projection.operations, queryClient)
}

export function seedRepoProjectionQueryData(
  repoRoot: string,
  repoInstanceId: string,
  projection: RepoRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  // Cache/session restore seed data is a UI placeholder, not an authoritative
  // section read, so do not backfill snapshot/status section caches here.
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

export function scheduleRepoRuntimeProjectionRefresh(
  repoRoot: string,
  repoInstanceId: string,
  options: { queryClient?: QueryClient; delaysMs?: readonly number[] } = {},
): void {
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  const delaysMs = options.delaysMs ?? RUNTIME_PROJECTION_REFRESH_DELAYS_MS
  invalidateRepoRuntimeProjectionQueries(repoRoot, repoInstanceId, queryClient)
  for (const delayMs of delaysMs) {
    globalThis.setTimeout(() => {
      invalidateRepoRuntimeProjectionQueries(repoRoot, repoInstanceId, queryClient)
    }, delayMs)
  }
}
