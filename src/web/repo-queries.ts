import { useQuery } from '@tanstack/react-query'
import type { RepoPullRequestScope } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  repoLogQueryOptions,
  repoOperationsReadModelQueryOptions,
  repoPullRequestsReadModelQueryOptions,
  repoSnapshotReadModelQueryOptions,
  repoRemoteBranchesQueryOptions,
  repoWorktreeStatusReadModelQueryOptions,
} from '#/web/repo-query-options.ts'
import { projectRepoOperationsQueryData } from '#/web/repo-query-cache.ts'

export function useRepoSnapshotReadModel(repoRoot: WorkspaceId | null, workspaceRuntimeId: string, enabled: boolean) {
  const query = useQuery(repoSnapshotReadModelQueryOptions(repoRoot, workspaceRuntimeId, enabled))
  return repoReadProjection(query, query.error)
}

export function useRepoPullRequestsReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  scope: RepoPullRequestScope,
  enabled: boolean,
) {
  return useQuery(repoPullRequestsReadModelQueryOptions(repoRoot, workspaceRuntimeId, scope, enabled))
}

export function useRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  const query = useQuery(repoWorktreeStatusReadModelQueryOptions(repoRoot, workspaceRuntimeId, enabled))
  return repoReadProjection(query, query.error)
}

function repoReadProjection<T extends object>(query: T, error: unknown) {
  return {
    ...query,
    displayError: repoReadError(error),
  }
}

function repoReadError(error: unknown): Error | null {
  if (!error) return null
  return error instanceof Error ? error : new Error(String(error))
}

export function useRepoLogQuery(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options: { count?: number; skip?: number; enabled?: boolean } = {},
) {
  return useQuery(repoLogQueryOptions(repoRoot, workspaceRuntimeId, branch, options))
}

export function useRepoRemoteBranchesQuery(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery(repoRemoteBranchesQueryOptions(repoRoot, workspaceRuntimeId, options))
}

export function useRepoOperationsReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  options: { includeSettled?: boolean; enabled?: boolean } = {},
) {
  const query = useQuery(repoOperationsReadModelQueryOptions(repoRoot, workspaceRuntimeId, options))
  return { ...query, data: projectRepoOperationsQueryData(query) }
}
