import type { Query } from '@tanstack/query-core'
import type { QueryClient } from '@tanstack/query-core'
import type { RepoPullRequestScope, RepoPullRequestsResponse } from '#/shared/api-types.ts'
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
  fetchQueryOwnedRepoOperationsReadModel,
  fetchQueryOwnedRepoMetadataQuery,
  fetchQueryOwnedRepoPullRequestsReadModel,
  fetchQueryOwnedRepoSnapshotReadModel,
  fetchQueryOwnedRepoWorktreeStatusReadModel,
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
  return {
    queryKey: repoSnapshotQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoSnapshotReadModel(repoRoot, workspaceRuntimeId, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function repoWorktreeStatusQueryOptions(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return {
    queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    refetchOnMount: refetchStatusWhenFirstObserverMounts,
    refetchOnWindowFocus: 'always' as const,
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function repoOperationsQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { includeSettled?: boolean } = {},
) {
  const includeSettled = options.includeSettled === true
  return {
    queryKey: repoOperationsQueryKey(repoRoot, workspaceRuntimeId, includeSettled),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoOperationsReadModel(repoRoot, workspaceRuntimeId, includeSettled, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: Number.POSITIVE_INFINITY,
  }
}

export function repoPullRequestsQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  scope: RepoPullRequestScope,
) {
  return {
    queryKey: repoPullRequestsQueryKey(repoRoot, workspaceRuntimeId, scope),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoPullRequestsReadModel(repoRoot, workspaceRuntimeId, scope, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    staleTime: (query: { state: { data?: RepoPullRequestsResponse } }) =>
      pullRequestCollectionCacheTtlMs(
        scope.kind === 'branch-detail' ? 'full' : 'summary',
        query.state.data?.pullRequests?.map((entry) => entry.pullRequest) ?? [],
      ),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  }
}

export function repoLogQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_REPOSITORY_LOG_COUNT
  const skip = options.skip ?? 0
  return {
    queryKey: repoLogQueryKey(repoRoot, workspaceRuntimeId, branch, count, skip),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoMetadataQuery(repoRoot, workspaceRuntimeId, client, () =>
        getRepoLog(repoRoot, workspaceRuntimeId, branch, { count, skip }),
      ),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    enabled: options.enabled,
  }
}

export function repoRemoteBranchesQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return {
    queryKey: repoRemoteBranchesQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ client }: { client: QueryClient }) =>
      fetchQueryOwnedRepoMetadataQuery(repoRoot, workspaceRuntimeId, client, () =>
        getRepoRemoteBranches(repoRoot, workspaceRuntimeId),
      ),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    enabled: options.enabled,
  }
}
