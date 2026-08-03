import type { ExecResult } from '#/web/types.ts'

/** A bare cancellation has no confirmed partial success that the user must inspect. */
export function isSilentBranchActionCancellation(result: ExecResult): boolean {
  return !result.ok && result.message === 'cancelled' && !result.recoveryMessageKeys?.length
}
