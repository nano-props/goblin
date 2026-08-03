import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RepoMutationExecResult } from '#/shared/git-types.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/workspaces/branch-action-types.ts'
import { isSilentBranchActionCancellation } from '#/web/stores/workspaces/branch-action-result.ts'

export function isPushProtected(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch)
}

export function deleteBranchNeedsForceConfirm(result: RepoMutationExecResult, force: boolean): boolean {
  return !force && !result.ok && result.message === 'error.branch-not-fully-merged'
}

export function removeWorktreeNeedsForceConfirm(
  result: RepoMutationExecResult,
  deleteBranch: boolean,
  forceDeleteBranch: boolean,
): boolean {
  return !result.ok && result.message === 'error.cannot-remove-unpushed-worktree' && deleteBranch && !forceDeleteBranch
}

export async function dispatchRepoBranchAction(
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  action: RepoBranchAction,
  runBranchAction: (
    id: WorkspaceId,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<RepoMutationExecResult | null>,
  options?: {
    deferResultMessages?: string[]
    handleResult?: (result: RepoMutationExecResult) => boolean
  },
): Promise<RepoMutationExecResult | null> {
  const result = await runBranchAction(repoId, action, {
    workspaceRuntimeId: workspaceRuntimeId,
    deferResultMessages: options?.deferResultMessages,
  })
  if (!result || isSilentBranchActionCancellation(result)) return null
  options?.handleResult?.(result)
  return result
}
