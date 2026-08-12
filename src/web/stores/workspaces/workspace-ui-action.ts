import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

export async function dispatchWorkspaceUiAction(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  op: string,
  action: () => Promise<ExecResult>,
  options?: {
    silentSuccessOps?: ReadonlySet<string>
    handleResult?: (result: ExecResult) => boolean
    reportResult?: (workspaceId: WorkspaceId, result: ExecResult, workspaceRuntimeId: string) => void
  },
): Promise<ExecResult | null> {
  const result = await runWorkspaceUiAction(action)
  if (!result) return null
  if (options?.handleResult?.(result)) return result
  if (!(result.ok && options?.silentSuccessOps?.has(op))) {
    options?.reportResult?.(workspaceId, result, workspaceRuntimeId)
  }
  return result
}

export async function runWorkspaceUiAction(action: () => Promise<ExecResult>): Promise<ExecResult | null> {
  let result: ExecResult
  try {
    result = await action()
  } catch (error) {
    if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) throw error
    result = { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (!result.ok && result.message === 'cancelled') return null
  return result
}
