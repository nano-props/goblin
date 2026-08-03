import type { RepoMutationExecResult } from '#/shared/git-types.ts'

/** A bare cancellation has no confirmed partial success that the user must inspect. */
export function isSilentBranchActionCancellation(result: RepoMutationExecResult): boolean {
  return !result.ok && result.message === 'cancelled' && !result.recoveryMessageKeys?.length
}
