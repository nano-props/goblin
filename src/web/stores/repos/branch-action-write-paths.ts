import { PROTECTED_BRANCHES } from '#/shared/git-types.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'

export function isPushProtected(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch)
}

export function deleteBranchNeedsForceConfirm(result: ExecResult, force: boolean): boolean {
  return !force && !result.ok && result.message === 'error.branch-not-fully-merged'
}

export function removeWorktreeNeedsForceConfirm(
  result: ExecResult,
  alsoDeleteBranch: boolean,
  forceDeleteBranch: boolean,
): boolean {
  return (
    !result.ok && result.message === 'error.cannot-remove-unpushed-worktree' && alsoDeleteBranch && !forceDeleteBranch
  )
}

export async function dispatchRepoBranchAction(
  repoId: string,
  instanceToken: number,
  action: RepoBranchAction,
  runBranchAction: (
    id: string,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<ExecResult | null>,
  options?: {
    deferResultMessages?: string[]
    handleResult?: (result: ExecResult) => boolean
  },
): Promise<ExecResult | null> {
  const result = await runBranchAction(repoId, action, {
    token: instanceToken,
    deferResultMessages: options?.deferResultMessages,
  })
  if (!result || (!result.ok && result.message === 'cancelled')) return null
  options?.handleResult?.(result)
  return result
}

export async function dispatchRepoUiAction(
  repoId: string,
  instanceToken: number,
  op: string,
  fn: () => Promise<ExecResult>,
  setLastResult: (repoId: string, result: ExecResult, token: number) => void,
  options?: {
    silentSuccessOps?: Set<string>
    handleResult?: (result: ExecResult) => boolean
  },
): Promise<ExecResult | null> {
  let result: ExecResult
  try {
    result = await fn()
  } catch (err) {
    result = { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  if (!result.ok && result.message === 'cancelled') return null
  if (options?.handleResult?.(result)) return result
  const skipSuccessToast = result.ok && options?.silentSuccessOps?.has(op)
  if (!skipSuccessToast) setLastResult(repoId, result, instanceToken)
  return result
}
