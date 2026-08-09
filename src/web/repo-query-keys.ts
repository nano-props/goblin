import type { RepoPullRequestScope } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export function repoSnapshotQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'snapshot'] as const
}

export function repoPullRequestsQueryKey(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  scope: RepoPullRequestScope,
) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'pull-requests', scope] as const
}

export function repoOperationsQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string, includeSettled = false) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations', { includeSettled }] as const
}

export function repoWorktreeStatusQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-status'] as const
}

export function repoWorktreeBootstrapPreviewQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'worktree-bootstrap-preview'] as const
}

export function repoDataQueryKey(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId] as const
}

export function repoOperationsQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'operations'] as const
}

export function repoPullRequestsQueryPrefix(repoRoot: WorkspaceId, workspaceRuntimeId: string) {
  return ['repo-data', repoRoot, workspaceRuntimeId, 'pull-requests'] as const
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
