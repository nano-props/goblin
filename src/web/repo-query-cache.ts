import type { QueryClient } from '@tanstack/react-query'
import type {
  GitWorkspaceRuntimeProjection,
  RepoOperationsSnapshot,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  repoOperationsQueryKey,
  repoProjectionQueryPrefix,
  repoProjectionQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'

export function getRepoProjectionPlaceholderData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
  queryClient: QueryClient = primaryWindowQueryClient,
): GitWorkspaceRuntimeProjection | undefined {
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
  return {
    snapshot: cached.snapshot,
    pullRequests: null,
    requested: { branch: requestedBranch, pullRequestMode: requestedMode },
    lastFetchAt: null,
    loadedAt: 0,
  }
}

function findRepoProjectionPlaceholderSource(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null,
  mode: PullRequestFetchMode,
  queryClient: QueryClient,
): GitWorkspaceRuntimeProjection | undefined {
  const candidates = queryClient
    .getQueriesData<GitWorkspaceRuntimeProjection>({
      queryKey: repoProjectionQueryPrefix(repoRoot, workspaceRuntimeId),
    })
    .map(([, projection]) => projection)
    .filter((projection): projection is GitWorkspaceRuntimeProjection => !!projection?.snapshot)
  candidates.sort(
    (left, right) =>
      repoProjectionPlaceholderRank(left, branch, mode) - repoProjectionPlaceholderRank(right, branch, mode),
  )
  return candidates[0]
}

function repoProjectionPlaceholderRank(
  projection: GitWorkspaceRuntimeProjection,
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
}

export function getRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): GitWorkspaceRuntimeProjection | undefined {
  return queryClient.getQueryData<GitWorkspaceRuntimeProjection>(
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
  projection: GitWorkspaceRuntimeProjection,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoProjectionQueryKey(repoRoot, workspaceRuntimeId, branch, mode), projection)
}

export function seedRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  projection: GitWorkspaceRuntimeProjection | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  if (!projection) return
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
