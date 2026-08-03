import { serverLogger } from '#/server/logger.ts'
import { IpcError } from '#/shared/ipc-error.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { isCurrentWorkspaceRuntime } from '#/server/modules/workspace-runtimes.ts'
import { isRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { settleRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'
import { isRepositoryBoundaryUnavailableError } from '#/server/modules/repository-boundary-error.ts'
import { isWorkspaceRuntimeAdmissionClosedError } from '#/server/modules/workspace-runtime-admission-error.ts'
import { OperationCancelledError } from '#/shared/operation-cancelled.ts'
import { isRepoMembershipReadConflictError } from '#/server/modules/repo-membership-read-conflict.ts'
import { isRepoMutationRuntimeFailureError } from '#/server/modules/repo-mutation-runtime-failure.ts'
import { appendRepoMutationRecoveryMessageKey, type RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import { stopBackgroundSyncRuntime } from '#/server/modules/background-sync.ts'
import type { RemoteWorkspaceRuntimeFailureError } from '#/server/modules/remote-workspace-runtime-failure.ts'

const workspaceRuntimeRequestLogger = serverLogger.child({ module: 'workspace-runtime-request' })

export function requireCurrentWorkspaceRuntime(
  userId: string | null | undefined,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): string {
  if (!userId) throw new IpcError({ code: 'UNAUTHORIZED', message: 'Unauthorized' })
  if (!isCurrentWorkspaceRuntime(userId, workspaceId, workspaceRuntimeId)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: 'error.workspace-runtime-stale' })
  }
  return userId
}

export async function runWorkspaceRuntimeRequest<T>(input: {
  userId: string
  run: () => Promise<T>
  label: string
  signal?: AbortSignal
}): Promise<T> {
  return await runRuntimeRequest(input, 'error.workspace-operation-failed')
}

export async function runGitWorkspaceRuntimeRequest<T>(input: {
  userId: string
  run: () => Promise<T>
  label: string
  signal?: AbortSignal
}): Promise<T> {
  return await runRuntimeRequest(input, 'error.failed-read-repo')
}

export async function runGitWorkspaceMutationRuntimeRequest(input: {
  userId: string
  run: () => Promise<RepoMutationResult>
  label: string
  signal?: AbortSignal
}): Promise<RepoMutationResult> {
  try {
    return await input.run()
  } catch (error) {
    if (!isRepoMutationRuntimeFailureError(error)) {
      return await throwRuntimeRequestError(input, error, 'error.failed-read-repo')
    }
    let mutation = error.mutation
    const lifecycleSettled = await settleRuntimeFailureAndStopAutomation(
      input.userId,
      input.label,
      error.runtimeFailure,
    )
    if (!lifecycleSettled) {
      mutation = mutationWithRuntimeSettlementRecovery(mutation)
    }
    workspaceRuntimeRequestLogger.warn({ err: error.runtimeFailure, label: input.label }, 'mutation runtime failed')
    return mutation
  }
}

function mutationWithRuntimeSettlementRecovery(mutation: RepoMutationResult): RepoMutationResult {
  const runtimeRecoveryKey = 'error.workspace-runtime-settlement-failed' as const
  const recoveryMessageKeys = appendRepoMutationRecoveryMessageKey(mutation.recoveryMessageKeys, runtimeRecoveryKey)
  if (recoveryMessageKeys === mutation.recoveryMessageKeys) return mutation
  return { ...mutation, recoveryMessageKeys }
}

async function runRuntimeRequest<T>(
  input: { userId: string; run: () => Promise<T>; label: string; signal?: AbortSignal },
  remoteFailureMessage: 'error.workspace-operation-failed' | 'error.failed-read-repo',
): Promise<T> {
  try {
    return await input.run()
  } catch (error) {
    return await throwRuntimeRequestError(input, error, remoteFailureMessage)
  }
}

async function throwRuntimeRequestError(
  input: { userId: string; label: string; signal?: AbortSignal },
  error: unknown,
  remoteFailureMessage: 'error.workspace-operation-failed' | 'error.failed-read-repo',
): Promise<never> {
  if (isWorkspaceRuntimeAdmissionClosedError(error)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: error.message })
  }
  if (isRepoMembershipReadConflictError(error)) {
    throw new IpcError({ code: 'BAD_REQUEST', message: error.message })
  }
  if (error instanceof OperationCancelledError) throw error
  if (isRemoteWorkspaceRuntimeFailure(error)) {
    const lifecycleSettled = await settleRuntimeFailureAndStopAutomation(input.userId, input.label, error)
    workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
    const message = lifecycleSettled ? remoteFailureMessage : 'error.workspace-runtime-settlement-failed'
    throw new IpcError({ code: 'BAD_REQUEST', message })
  }
  if (input.signal?.aborted) throw error
  if (isRepositoryBoundaryUnavailableError(error)) {
    workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'repository boundary unavailable')
    throw new IpcError({ code: 'BAD_REQUEST', message: error.message })
  }
  workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
  throw error
}

async function settleRuntimeFailureAndStopAutomation(
  userId: string,
  label: string,
  error: RemoteWorkspaceRuntimeFailureError,
): Promise<boolean> {
  let lifecycleSettled = true
  try {
    await settleRemoteWorkspaceRuntimeFailure(userId, error)
  } catch (settlementError) {
    lifecycleSettled = false
    workspaceRuntimeRequestLogger.warn({ err: settlementError, label }, 'failed to settle workspace runtime')
    // No lifecycle transition was committed, so the lifecycle event cannot
    // stop automation. Ask the background owner directly for this uncertain case.
    stopBackgroundSyncRuntime(userId, error.workspaceId, error.workspaceRuntimeId)
  }
  return lifecycleSettled
}
