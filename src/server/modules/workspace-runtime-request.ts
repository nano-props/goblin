import { serverLogger } from '#/server/logger.ts'
import { IpcError } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { isCurrentWorkspaceRuntime } from '#/server/modules/workspace-runtimes.ts'
import { isRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure.ts'
import { settleRemoteWorkspaceRuntimeFailure } from '#/server/modules/remote-workspace-runtime-failure-settlement.ts'

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

async function runRuntimeRequest<T>(
  input: { userId: string; run: () => Promise<T>; label: string; signal?: AbortSignal },
  remoteFailureMessage: 'error.workspace-operation-failed' | 'error.failed-read-repo',
): Promise<T> {
  try {
    return await input.run()
  } catch (error) {
    if (input.signal?.aborted) throw error
    if (isRemoteWorkspaceRuntimeFailure(error)) {
      await settleRemoteWorkspaceRuntimeFailure(input.userId, error)
      workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
      throw new IpcError({ code: 'BAD_REQUEST', message: remoteFailureMessage })
    }
    workspaceRuntimeRequestLogger.warn({ err: error, label: input.label }, 'failed')
    throw error
  }
}
