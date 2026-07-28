import { queryOptions, skipToken, type Query } from '@tanstack/react-query'
import type { RepoPullRequestScope } from '#/shared/api-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  repoLogQueryKey,
  repoOperationsQueryKey,
  repoPullRequestsQueryKey,
  repoSnapshotQueryKey,
  repoRemoteBranchesQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'
import {
  fetchRepoOperationsReadModel,
  fetchRepoMetadataQuery,
  fetchRepoPullRequestsReadModel,
  fetchRepoSnapshotReadModel,
  fetchRepoWorktreeStatusReadModel,
  isStaleRepoRuntimeReadError,
} from '#/web/repo-query-runtime.ts'
import { getRepoLog, getRepoRemoteBranches } from '#/web/repo-client.ts'
import { pullRequestCollectionCacheTtlMs } from '#/shared/pull-request-state.ts'

const retryStaleRepoRuntimeRead = (_failureCount: number, error: unknown): boolean => isStaleRepoRuntimeReadError(error)

function refetchStatusWhenFirstObserverMounts<TQueryFnData, TError, TData, TQueryKey extends readonly unknown[]>(
  query: Query<TQueryFnData, TError, TData, TQueryKey>,
): boolean | 'always' {
  // Revalidate a cached workspace when it becomes visible again, but do not
  // multiply reads as the sidebar, dashboard, and workspace panes subscribe.
  return query.getObserversCount() === 1 ? 'always' : false
}

export function repoSnapshotQueryOptions(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return queryOptions({
    queryKey: repoSnapshotQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal, client }) => fetchRepoSnapshotReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function repoWorktreeStatusQueryOptions(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return queryOptions({
    queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    refetchOnMount: refetchStatusWhenFirstObserverMounts,
    refetchOnWindowFocus: 'always',
    staleTime: Number.POSITIVE_INFINITY,
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
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    enabled: options.enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function repoSnapshotReadModelQueryOptions(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  return queryOptions({
    queryKey: repoSnapshotQueryKey(repoRoot, workspaceRuntimeId),
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) => fetchRepoSnapshotReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: active,
    subscribed: active,
  })
}

export function repoPullRequestsReadModelQueryOptions(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  scope: RepoPullRequestScope,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  return queryOptions({
    queryKey: repoPullRequestsQueryKey(repoRoot, workspaceRuntimeId, scope),
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) => fetchRepoPullRequestsReadModel(repoRoot, workspaceRuntimeId, scope, signal, client),
    retry: false,
    staleTime: (query) =>
      pullRequestCollectionCacheTtlMs(
        scope.kind === 'branch-detail' ? 'full' : 'summary',
        query.state.data?.pullRequests?.map((entry) => entry.pullRequest) ?? [],
      ),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: active,
    subscribed: active,
  })
}

export function repoWorktreeStatusReadModelQueryOptions(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  return queryOptions({
    queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    refetchOnMount: refetchStatusWhenFirstObserverMounts,
    refetchOnWindowFocus: 'always',
    staleTime: Number.POSITIVE_INFINITY,
    enabled: active,
    subscribed: active,
  })
}

export function repoLogQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return queryOptions({
    queryKey: repoLogQueryKey(repoRoot, workspaceRuntimeId, branch, count, skip),
    queryFn: ({ signal, client }) =>
      fetchRepoMetadataQuery(repoRoot, workspaceRuntimeId, signal, client, () =>
        getRepoLog(repoRoot, workspaceRuntimeId, branch, { count, skip, signal }),
      ),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    enabled: options.enabled,
  })
}

export function repoRemoteBranchesQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return queryOptions({
    queryKey: repoRemoteBranchesQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal, client }) =>
      fetchRepoMetadataQuery(repoRoot, workspaceRuntimeId, signal, client, () =>
        getRepoRemoteBranches(repoRoot, workspaceRuntimeId, signal),
      ),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    enabled: options.enabled,
  })
}

export function repoOperationsReadModelQueryOptions(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  const enabled = options.enabled !== false && repoRoot !== null
  return queryOptions({
    queryKey: repoOperationsQueryKey(repoRoot, workspaceRuntimeId, includeSettled),
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) =>
            fetchRepoOperationsReadModel(repoRoot, workspaceRuntimeId, includeSettled, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
    subscribed: enabled,
  })
}
