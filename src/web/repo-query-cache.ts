import type { QueryClient } from '@tanstack/react-query'
import type {
  RepoSnapshot,
  RepoSnapshotResponse,
  RepoOperationsSnapshot,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoOperationsQueryKey, repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'

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

export function getRepoSnapshotQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoSnapshot | undefined {
  return queryClient.getQueryData<RepoSnapshotResponse>(repoSnapshotQueryKey(repoRoot, workspaceRuntimeId))?.snapshot
}

export function requireRepoSnapshotQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): RepoSnapshot {
  const snapshot = getRepoSnapshotQueryData(repoRoot, workspaceRuntimeId, queryClient)
  if (!snapshot) throw new Error(`repository snapshot query data unavailable for workspace: ${repoRoot}`)
  return snapshot
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

export function setRepoSnapshotQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: RepoSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData(repoSnapshotQueryKey(repoRoot, workspaceRuntimeId), { snapshot })
}

export function seedRepoSnapshotQueryData(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: RepoSnapshot | null,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  if (!snapshot) return
  queryClient.setQueryData(repoSnapshotQueryKey(repoRoot, workspaceRuntimeId), { snapshot })
}
