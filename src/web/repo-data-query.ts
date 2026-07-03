import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  getRepoLog,
  getRepoPullRequests,
  getRepoRemoteBranches,
  getRepoSnapshot,
  getRepoStatus,
  readRepoBulk,
} from '#/web/repo-client.ts'
import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import {
  DEFAULT_REPOSITORY_LOG_COUNT,
  type LogEntry,
  type PullRequestFetchMode,
  type WorktreeStatus,
} from '#/shared/git-types.ts'

export interface RepoBulkReadCacheEntry {
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
    ...(branches ? [...branches].sort() : []),
    mode ?? 'full',
  ] as const
}

export function repoBulkReadQueryKey(
  repoRoot: string,
  repoInstanceId: string,
  include?: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'>,
) {
  return ['repo-data', repoRoot, repoInstanceId, 'bulk', ...(include ? [...include].sort() : [])] as const
}

export function repoLogQueryKey(repoRoot: string, branch: string, count: number, skip: number) {
  return ['repo-data', repoRoot, 'log', branch, count, skip] as const
}

export function repoRemoteBranchesQueryKey(repoRoot: string) {
  return ['repo-data', repoRoot, 'remote-branches'] as const
}

export function repoSnapshotQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: repoSnapshotQueryKey(repoRoot, repoInstanceId),
    queryFn: ({ signal }) => getRepoSnapshot(repoRoot, signal),
  })
}

export function repoStatusQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: repoStatusQueryKey(repoRoot, repoInstanceId),
    queryFn: ({ signal }) => getRepoStatus(repoRoot, signal),
  })
}

export function repoPullRequestsQueryOptions(
  repoRoot: string,
  repoInstanceId: string,
  branches?: readonly string[],
  mode?: PullRequestFetchMode,
) {
  return queryOptions({
    queryKey: repoPullRequestsQueryKey(repoRoot, repoInstanceId, branches, mode),
    queryFn: ({ signal }) => getRepoPullRequests(repoRoot, branches ? [...branches] : undefined, { mode }, signal),
  })
}

export function repoBulkReadQueryOptions(
  repoRoot: string,
  repoInstanceId: string,
  include?: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'>,
) {
  return queryOptions({
    queryKey: repoBulkReadQueryKey(repoRoot, repoInstanceId, include),
    queryFn: ({ signal }) => readRepoBulk(repoRoot, { include, signal }),
  })
}

export function repoLogQueryOptions(
  repoRoot: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return queryOptions({
    queryKey: repoLogQueryKey(repoRoot, branch, count, skip),
    queryFn: ({ signal }) => getRepoLog(repoRoot, branch, { count, skip, signal }),
    enabled: options.enabled,
  })
}

export function repoRemoteBranchesQueryOptions(repoRoot: string, options: { enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: repoRemoteBranchesQueryKey(repoRoot),
    queryFn: ({ signal }) => getRepoRemoteBranches(repoRoot, signal),
    enabled: options.enabled,
  })
}

export function useRepoSnapshotQuery(repoRoot: string, repoInstanceId: string) {
  return useQuery(repoSnapshotQueryOptions(repoRoot, repoInstanceId))
}

export function useRepoStatusQuery(repoRoot: string, repoInstanceId: string) {
  return useQuery(repoStatusQueryOptions(repoRoot, repoInstanceId))
}

export function useRepoPullRequestsQuery(
  repoRoot: string,
  repoInstanceId: string,
  branches?: readonly string[],
  mode?: PullRequestFetchMode,
) {
  return useQuery(repoPullRequestsQueryOptions(repoRoot, repoInstanceId, branches, mode))
}

export function useRepoLogQuery(
  repoRoot: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  return useQuery(repoLogQueryOptions(repoRoot, branch, options))
}

export function useRepoRemoteBranchesQuery(repoRoot: string, options: { enabled?: boolean } = {}) {
  return useQuery(repoRemoteBranchesQueryOptions(repoRoot, options))
}

export function setRepoLogQueryData(
  repoRoot: string,
  branch: string,
  entries: LogEntry[],
  options: { count?: number; skip?: number; queryClient?: QueryClient } = {},
): void {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  const queryClient = options.queryClient ?? primaryWindowQueryClient
  queryClient.setQueryData(repoLogQueryKey(repoRoot, branch, count, skip), entries)
}

export function setRepoRemoteBranchesQueryData(
  repoRoot: string,
  branches: string[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoRemoteBranchesQueryKey(repoRoot), branches)
}

export function setRepoSnapshotQueryData(
  repoRoot: string,
  repoInstanceId: string,
  snapshot: RepoSnapshot | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoSnapshotQueryKey(repoRoot, repoInstanceId), snapshot)
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
