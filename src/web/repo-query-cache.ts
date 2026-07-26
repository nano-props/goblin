import type { QueryClient } from '@tanstack/react-query'
import type {
  GitWorkspaceRuntimeProjection,
  RepoOperationsSnapshot,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoOperationsQueryKey, repoProjectionQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'

export function getRepoOperationsQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoOperationsSnapshot | undefined {
  const queryKey = repoOperationsQueryKey(repoRoot, workspaceRuntimeId, false)
  return projectRepoOperationsQueryData(queryClient.getQueryState<RepoOperationsSnapshot>(queryKey))
}

export function projectRepoOperationsQueryData(
  query: { status: 'pending' | 'error' | 'success'; data: RepoOperationsSnapshot | undefined } | undefined,
): RepoOperationsSnapshot | undefined {
  return query?.status === 'success' ? query.data : undefined
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
  const projection = queryClient.getQueryData<GitWorkspaceRuntimeProjection>(
    repoProjectionQueryKey(repoRoot, workspaceRuntimeId, branch, mode),
  )
  return projection && projection.loadedAt > 0 ? projection : undefined
}

export function getSuccessfulRepoProjectionQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): GitWorkspaceRuntimeProjection | undefined {
  const query = queryClient.getQueryState<GitWorkspaceRuntimeProjection>(
    repoProjectionQueryKey(repoRoot, workspaceRuntimeId, branch, mode),
  )
  const projection = query?.status === 'success' ? query.data : undefined
  return projection && projection.loadedAt > 0 ? projection : undefined
}

export function getRepoWorktreeStatusQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoWorktreeStatusSnapshot | undefined {
  return queryClient.getQueryData<RepoWorktreeStatusSnapshot>(repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId))
}

export function getSuccessfulRepoWorktreeStatusQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoWorktreeStatusSnapshot | undefined {
  const query = queryClient.getQueryState<RepoWorktreeStatusSnapshot>(
    repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId),
  )
  return query?.status === 'success' ? query.data : undefined
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
