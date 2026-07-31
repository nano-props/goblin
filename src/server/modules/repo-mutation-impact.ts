import { compact } from 'es-toolkit'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import { normalizeRemoteWorkspaceRef, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { formatWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RepoMutationResult extends ExecResult {
  /** Repo sessions whose snapshots changed, including partial failures after an earlier write. */
  affectedRepoIds?: readonly WorkspaceId[]
  /** Filesystem roots whose checked-out contents changed during the mutation. */
  affectedWorktreePaths?: readonly string[]
}

export function withAffectedRepoIds(result: ExecResult, affectedRepoIds: readonly WorkspaceId[]): RepoMutationResult {
  const unique = Array.from(new Set(affectedRepoIds.filter((repoId) => repoId.length > 0)))
  return unique.length > 0 ? { ...result, affectedRepoIds: unique } : result
}

export function withAffectedRepoIdsIfChanged(
  result: ExecResult,
  affectedRepoIds: readonly WorkspaceId[],
): RepoMutationResult {
  return result.ok || result.repositoryStateChanged ? withAffectedRepoIds(result, affectedRepoIds) : result
}

export function localWorktreeRepoIds(worktrees: readonly WorktreeInfo[]): WorkspaceId[] {
  return compact(worktrees.map((worktree) => (worktree.isBare ? null : workspaceIdForLocalWorktreePath(worktree.path))))
}

export function workspaceIdForLocalWorktreePath(worktreePath: string): WorkspaceId | null {
  const platform = process.platform === 'win32' ? 'win32' : 'posix'
  return formatWorkspaceLocator({ transport: 'file', platform, path: worktreePath }, platform)
}

export function remoteWorktreeRepoIds(
  target: RemoteWorkspaceTarget,
  worktreePaths: readonly string[] | undefined,
): WorkspaceId[] {
  if (!worktreePaths) return []
  return compact(
    worktreePaths.map((remotePath) => normalizeRemoteWorkspaceRef({ alias: target.alias, remotePath })?.id ?? null),
  )
}
