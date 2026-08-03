import { compact } from 'es-toolkit'
import type { ExecResult, WorktreeInfo } from '#/shared/git-types.ts'
import { normalizeRemoteWorkspaceRef, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { formatWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RepoMutationResult extends ExecResult {
  /** Repo projections that must be invalidated, including uncertain or partially applied failures. */
  repoIdsToInvalidate?: readonly WorkspaceId[]
  /** Checked-out filesystem projections that must be invalidated. */
  worktreePathsToInvalidate?: readonly string[]
  /** The worktree removal committed, even if a later lifecycle or branch step failed. */
  worktreeRemoved?: true
}

export function withRepoIdsToInvalidate<T extends ExecResult>(
  result: T,
  repoIdsToInvalidate: readonly WorkspaceId[],
): T & RepoMutationResult {
  const unique = Array.from(new Set(repoIdsToInvalidate.filter((repoId) => repoId.length > 0)))
  return unique.length > 0 ? { ...result, repoIdsToInvalidate: unique } : result
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
