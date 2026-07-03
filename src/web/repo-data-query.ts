import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  getRepoLog,
  getRepoPullRequests,
  getRepoRemoteBranches,
  getRepoSnapshot,
  getRepoStatus,
} from '#/web/repo-client.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT, type PullRequestFetchMode, type WorktreeStatus } from '#/shared/git-types.ts'

interface RepoBulkReadCacheEntry {
  snapshot: RepoSnapshot | null
  status: WorktreeStatus[]
  pullRequests: PullRequestEntry[] | null
}

export function repoSnapshotQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'snapshot'] as const
}

export function repoStatusQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'status'] as const
}

export function repoPullRequestsQueryKey(
  repoRoot: string,
  repoInstanceId: string,
  branches?: readonly string[],
  mode?: PullRequestFetchMode,
) {
  return [
    'repo-data',
    repoRoot,
    repoInstanceId,
    'pull-requests',
    {
      branches: branches ? [...branches].sort() : null,
      mode: mode ?? 'full',
    },
  ] as const
}

export function repoBulkReadQueryKey(
  repoRoot: string,
  repoInstanceId: string,
  include?: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'>,
) {
  return ['repo-data', repoRoot, repoInstanceId, 'bulk', { include: include ? [...include].sort() : null }] as const
}

export function repoDataQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId] as const
}

function repoLogQueryKey(repoRoot: string, repoInstanceId: string, branch: string, count: number, skip: number) {
  return ['repo-data', repoRoot, repoInstanceId, 'log', branch, count, skip] as const
}

function repoRemoteBranchesQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['repo-data', repoRoot, repoInstanceId, 'remote-branches'] as const
}

export function repoSnapshotQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: repoSnapshotQueryKey(repoRoot, repoInstanceId),
    queryFn: ({ signal }) => getRepoSnapshot(repoRoot, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function repoStatusQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: repoStatusQueryKey(repoRoot, repoInstanceId),
    queryFn: ({ signal }) => getRepoStatus(repoRoot, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function repoPullRequestsQueryOptions(
  repoRoot: string,
  repoInstanceId: string,
  branches?: readonly string[],
  mode?: PullRequestFetchMode,
) {
  return queryOptions({
    queryKey: repoPullRequestsQueryKey(repoRoot, repoInstanceId, branches, mode),
    queryFn: ({ signal }) => getRepoPullRequests(repoRoot, branches ? [...branches] : undefined, { mode }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  })
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

export function useRepoSnapshotReadModel(repoRoot: string, repoInstanceId: string, enabled: boolean) {
  return useQuery({
    ...repoSnapshotQueryOptions(repoRoot, repoInstanceId),
    enabled,
    subscribed: enabled,
  })
}

export function useRepoStatusReadModel(repoRoot: string, repoInstanceId: string, enabled: boolean) {
  return useQuery({
    ...repoStatusQueryOptions(repoRoot, repoInstanceId),
    enabled,
    subscribed: enabled,
  })
}

export function useRepoPullRequestsReadModel(
  repoRoot: string,
  repoInstanceId: string,
  branches: readonly string[] | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  return useQuery({
    ...repoPullRequestsQueryOptions(repoRoot, repoInstanceId, branches, mode),
    enabled,
    subscribed: enabled,
  })
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

export function setRepoSnapshotQueryData(
  repoRoot: string,
  repoInstanceId: string,
  snapshot: RepoSnapshot | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoSnapshotQueryKey(repoRoot, repoInstanceId), snapshot)
}

export function getRepoSnapshotQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoSnapshot | null | undefined {
  return queryClient.getQueryData<RepoSnapshot | null>(repoSnapshotQueryKey(repoRoot, repoInstanceId))
}

export function getRepoStatusQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): WorktreeStatus[] | undefined {
  return queryClient.getQueryData<WorktreeStatus[]>(repoStatusQueryKey(repoRoot, repoInstanceId))
}

export function getRepoPullRequestsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  branches: readonly string[] | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): PullRequestEntry[] | null | undefined {
  return queryClient.getQueryData<PullRequestEntry[] | null>(
    repoPullRequestsQueryKey(repoRoot, repoInstanceId, branches, mode),
  )
}

export function setRepoStatusQueryData(
  repoRoot: string,
  repoInstanceId: string,
  status: WorktreeStatus[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoStatusQueryKey(repoRoot, repoInstanceId), status)
}

export function setRepoPullRequestsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  branches: readonly string[] | undefined,
  mode: PullRequestFetchMode | undefined,
  pullRequests: PullRequestEntry[] | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoPullRequestsQueryKey(repoRoot, repoInstanceId, branches, mode), pullRequests)
}

export function setRepoBulkReadQueryData(
  repoRoot: string,
  repoInstanceId: string,
  include: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'> | undefined,
  result: RepoBulkReadCacheEntry,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoBulkReadQueryKey(repoRoot, repoInstanceId, include), result)
  setRepoSnapshotQueryData(repoRoot, repoInstanceId, result.snapshot, queryClient)
  setRepoStatusQueryData(repoRoot, repoInstanceId, result.status, queryClient)
  if (include?.includes('pullRequests')) {
    setRepoPullRequestsQueryData(repoRoot, repoInstanceId, undefined, undefined, result.pullRequests, queryClient)
  }
}

export function invalidateRepoDataQueries(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void queryClient.invalidateQueries({ queryKey: repoDataQueryKey(repoRoot, repoInstanceId) })
}
