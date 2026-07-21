import { useQuery } from '@tanstack/react-query'
import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  repoLogQueryOptions,
  repoOperationsReadModelQueryOptions,
  repoProjectionReadModelQueryOptions,
  repoRemoteBranchesQueryOptions,
  repoWorktreeStatusReadModelQueryOptions,
} from '#/web/repo-query-options.ts'
import { projectRepoOperationsQueryData } from '#/web/repo-query-cache.ts'

export function useRepoProjectionReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  branch: string | null | undefined,
  mode: PullRequestFetchMode | undefined,
  enabled: boolean,
) {
  return useQuery(repoProjectionReadModelQueryOptions(repoRoot, workspaceRuntimeId, branch, mode, enabled))
}

export function useRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId | null,
  workspaceRuntimeId: string,
  enabled: boolean,
) {
  return useQuery(repoWorktreeStatusReadModelQueryOptions(repoRoot, workspaceRuntimeId, enabled))
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
