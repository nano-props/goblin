import { queryOptions, skipToken } from '@tanstack/react-query'
import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  normalizeRepoProjectionBranch,
  normalizeRepoProjectionMode,
  repoLogQueryKey,
  repoOperationsQueryKey,
  repoProjectionQueryKey,
  repoRemoteBranchesQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'
import {
  fetchRepoOperationsReadModel,
  fetchRepoProjectionReadModel,
  fetchRepoSnapshotQuery,
  fetchRepoWorktreeStatusReadModel,
  isStaleRepoRuntimeReadError,
} from '#/web/repo-query-runtime.ts'
import { getRepoProjectionPlaceholderData } from '#/web/repo-query-cache.ts'
import { getRepoLog, getRepoRemoteBranches } from '#/web/repo-client.ts'

const retryStaleRepoRuntimeRead = (_failureCount: number, error: unknown): boolean => isStaleRepoRuntimeReadError(error)

export function repoProjectionQueryOptions(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  const requestedBranch = normalizeRepoProjectionBranch(branch)
  const requestedMode = normalizeRepoProjectionMode(mode)
  return queryOptions({
    queryKey: repoProjectionQueryKey(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode),
    queryFn: ({ signal, client }) =>
      fetchRepoProjectionReadModel(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    placeholderData: getRepoProjectionPlaceholderData(repoRoot, workspaceRuntimeId, branch, mode),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function repoWorktreeStatusQueryOptions(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return queryOptions({
    queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
    queryFn: ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
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

export function repoProjectionReadModelQueryOptions(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  const active = enabled && repoRoot !== null
  const requestedBranch = normalizeRepoProjectionBranch(branch)
  const requestedMode = normalizeRepoProjectionMode(mode)
  return queryOptions({
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
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
    placeholderData: repoRoot
      ? getRepoProjectionPlaceholderData(repoRoot, workspaceRuntimeId, requestedBranch, requestedMode)
      : undefined,
    staleTime: Number.POSITIVE_INFINITY,
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
    queryKey: ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-status'] as const,
    queryFn:
      repoRoot === null
        ? skipToken
        : ({ signal, client }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
    retry: retryStaleRepoRuntimeRead,
    retryDelay: 0,
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
      fetchRepoSnapshotQuery(repoRoot, workspaceRuntimeId, signal, client, () =>
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
      fetchRepoSnapshotQuery(repoRoot, workspaceRuntimeId, signal, client, () =>
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
    queryKey: ['repo-data', repoRoot, workspaceRuntimeId, 'operations', { includeSettled }] as const,
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
