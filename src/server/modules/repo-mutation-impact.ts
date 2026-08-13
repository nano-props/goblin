import { compact } from 'es-toolkit'
import type {
  ExecResult,
  ExecResultRecoveryMessageKey,
  RepoMutationExecResult,
  WorktreeInfo,
} from '#/shared/git-types.ts'
import { normalizeRemoteWorkspaceRef, type RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { formatWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export interface RepoMutationResult extends RepoMutationExecResult {
  /** Canonical filesystem target confirmed by the create-worktree source boundary. */
  createdWorktreePath?: string
  /** Repo projections that must be invalidated, including uncertain or partially applied failures. */
  repoIdsToInvalidate?: readonly WorkspaceId[]
  /** Checked-out filesystem projections that must be invalidated. */
  worktreePathsToInvalidate?: readonly string[]
}

export type CreateWorktreeMutationResult =
  (RepoMutationResult & { ok: false }) | (RepoMutationResult & { ok: true; createdWorktreePath: string })

/** Append one recovery notice while preserving the server-selected order and uniqueness. */
export function appendRepoMutationRecoveryMessageKey(
  recoveryMessageKeys: readonly ExecResultRecoveryMessageKey[] | undefined,
  recoveryMessageKey: ExecResultRecoveryMessageKey,
): readonly ExecResultRecoveryMessageKey[] {
  if (recoveryMessageKeys?.includes(recoveryMessageKey)) return recoveryMessageKeys
  return [...(recoveryMessageKeys ?? []), recoveryMessageKey]
}

/** Preserve first occurrence order while removing duplicate recovery notices. */
export function uniqueRepoMutationRecoveryMessageKeys(
  recoveryMessageKeys: readonly ExecResultRecoveryMessageKey[],
): readonly ExecResultRecoveryMessageKey[] {
  return Array.from(new Set(recoveryMessageKeys))
}

/** Project an internal mutation result without exposing impact or milestone authority. */
export function publicRepoMutationResult(result: RepoMutationResult): RepoMutationExecResult {
  const publicResult: RepoMutationExecResult = { ok: result.ok, message: result.message }
  if (result.recoveryMessageKeys?.length) publicResult.recoveryMessageKeys = result.recoveryMessageKeys
  if (result.worktreeBootstrap) publicResult.worktreeBootstrap = result.worktreeBootstrap
  return publicResult
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
