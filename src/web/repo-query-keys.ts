import type { PullRequestFetchMode } from '#/shared/git-types.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export function normalizeRepoProjectionBranch(branch?: string | null): string | null {
  return branch || null
}

export function normalizeRepoProjectionMode(mode?: PullRequestFetchMode): PullRequestFetchMode {
  return mode ?? 'full'
}

export function repoProjectionQueryKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  mode?: PullRequestFetchMode,
) {
  return [
    'repo-data',
    repoRoot,
    workspaceRuntimeId,
    'projection',
    { branch: normalizeRepoProjectionBranch(branch), mode: normalizeRepoProjectionMode(mode) },
  ] as const
}

export interface ParsedRepoProjectionQueryKey {
  repoRoot: WorkspaceId
  workspaceRuntimeId: string
  branch: string | null
  mode: PullRequestFetchMode
}

export function parseRepoProjectionQueryKey(queryKey: readonly unknown[]): ParsedRepoProjectionQueryKey | null {
  if (queryKey.length !== 5 || queryKey[0] !== 'repo-data' || queryKey[3] !== 'projection') return null
  const repoRoot = queryKey[1]
  const workspaceRuntimeId = queryKey[2]
  if (typeof repoRoot !== 'string' || typeof workspaceRuntimeId !== 'string') return null
  const workspaceId = canonicalWorkspaceLocator(repoRoot)
  if (!workspaceId) return null
  const options = queryKey[4]
  if (!options || typeof options !== 'object') return null
  const projection = options as { branch?: unknown; mode?: unknown }
  const branch = typeof projection.branch === 'string' && projection.branch.length > 0 ? projection.branch : null
  const mode = projection.mode === 'summary' ? 'summary' : 'full'
  return { repoRoot: workspaceId, workspaceRuntimeId, branch, mode }
}

export function repoOperationsQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string, includeSettled = false) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations', { includeSettled }] as const
}

export function repoWorktreeStatusQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-status'] as const
}

export function repoDataQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId] as const
}

export function repoProjectionQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'projection'] as const
}

export function repoOperationsQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations'] as const
}

export function repoLogQueryKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  count: number,
  skip: number,
) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'log', branch, count, skip] as const
}

export function repoRemoteBranchesQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'remote-branches'] as const
}
