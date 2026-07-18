import { failRemoteWorkspaceLifecycle } from '#/server/modules/workspace-runtimes.ts'
import { publishUserWorkspaceRuntimeInvalidation } from '#/server/modules/invalidation-broker.ts'
import {
  isRemoteWorkspaceRuntimeFailure,
  type RemoteWorkspaceRuntimeFailureError,
} from '#/server/modules/remote-workspace-runtime-failure.ts'

/**
 * Mark a workspace's remote lifecycle as failed from a classified
 * `RemoteWorkspaceRuntimeFailureError`, then invalidate the affected user's
 * workspace runtime so the frontend refetches and reflects the new state. The
 * non-`'settled'` branch silently no-ops: either the lifecycle is stale,
 * superseded, or the workspace is not actually remote — in every case
 * there is nothing to fail or invalidate.
 */
export async function settleRemoteWorkspaceRuntimeFailure(
  userId: string,
  error: RemoteWorkspaceRuntimeFailureError,
): Promise<void> {
  await failRemoteWorkspaceLifecycle({
    userId,
    workspaceId: error.workspaceId,
    workspaceRuntimeId: error.workspaceRuntimeId,
    reason: error.reason,
    ...(error.target ? { target: error.target } : {}),
    onTransition: () => publishUserWorkspaceRuntimeInvalidation(userId, { workspaceId: error.workspaceId }),
  })
}

/** Type guard wrapper that fans out to `settleRemoteWorkspaceRuntimeFailure` only when the error matches. */
export async function failRemoteWorkspaceRuntimeIfNeeded(userId: string, error: unknown): Promise<void> {
  if (!isRemoteWorkspaceRuntimeFailure(error)) return
  await settleRemoteWorkspaceRuntimeFailure(userId, error)
}
