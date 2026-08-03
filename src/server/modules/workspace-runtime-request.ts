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
import { publicRepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { ExecResult } from '#/shared/git-types.ts'

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
  run: () => Promise<ExecResult>
  label: string
  signal?: AbortSignal
}): Promise<ExecResult> {
  try {
    return await input.run()
  } catch (error) {
    if (!isRepoMutationRuntimeFailureError(error)) {
      return await throwRuntimeRequestError(input, error, 'error.failed-read-repo')
    }
    try {
      await settleRemoteWorkspaceRuntimeFailure(input.userId, error.runtimeFailure)
    } catch (settlementError) {
      // Runtime lifecycle projection must not replace an authoritative mutation
      // result. Surface the established facts and leave explicit runtime recovery
      // to the user instead of retrying or fabricating a settlement.
      workspaceRuntimeRequestLogger.warn(
        { err: settlementError, label: input.label },
        'failed to settle mutation runtime',
      )
    }
    workspaceRuntimeRequestLogger.warn({ err: error.runtimeFailure, label: input.label }, 'mutation runtime failed')
    return publicRepoMutationResult(error.mutation)
  }
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
  if (input.signal?.aborted) throw error
  if (isRemoteWorkspaceRuntimeFailure(error)) {
    await settleRemoteWorkspaceRuntimeFailure(input.userId, error)
    workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
    throw new IpcError({ code: 'BAD_REQUEST', message: remoteFailureMessage })
  }
  if (isRepositoryBoundaryUnavailableError(error)) {
    workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'repository boundary unavailable')
    throw new IpcError({ code: 'BAD_REQUEST', message: error.message })
  }
  workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
  throw error
}
