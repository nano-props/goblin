import { failRepoRemoteLifecycle } from '#/server/modules/workspace-runtimes.ts'
import { publishUserRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  isRemoteRepoRuntimeFailure,
  type RemoteRepoRuntimeFailureError,
} from '#/server/modules/remote-runtime-failure.ts'

/**
 * Mark a repo's remote lifecycle as failed from a classified
 * `RemoteRepoRuntimeFailureError`, then invalidate the affected user's
 * `remote-lifecycle` query so the frontend refetches and reflects the new
 * state. The non-`'settled'` branch silently no-ops: either the lifecycle
 * is stale, superseded, or the repo is not actually remote — in every case
 * there is nothing to fail or invalidate.
 */
export function settleRemoteRuntimeFailure(userId: string, error: RemoteRepoRuntimeFailureError): void {
  const failed = failRepoRemoteLifecycle({
    userId,
    workspaceId: error.repoRoot,
    workspaceRuntimeId: error.workspaceRuntimeId,
    reason: error.reason,
    ...(error.target ? { target: error.target } : {}),
  })
  if (failed.kind !== 'settled') return
  publishUserRepoQueryInvalidation(userId, { repoId: error.repoRoot, query: 'remote-lifecycle' })
}

/** Type guard wrapper that fans out to `settleRemoteRuntimeFailure` only when the error matches. */
export function failRemoteRuntimeIfNeeded(userId: string, error: unknown): void {
  if (!isRemoteRepoRuntimeFailure(error)) return
  settleRemoteRuntimeFailure(userId, error)
}
