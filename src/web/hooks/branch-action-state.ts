import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import { branchActionKindFromReason, isBranchActionReason } from '#/web/stores/repos/operations.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
export type BranchActionItemId =
  | 'copyPatch'
  | 'checkout'
  | 'pull'
  | 'push'
  | 'remote'
  | 'terminal'
  | 'editor'
  | 'deleteBranch'
  | 'removeWorktree'

export function isBranchActionBlocked(repo: RepoState): boolean {
  return repo.operations.branchAction.phase !== 'idle'
}

export function branchActionItemIdFromKind(kind: RepoBranchActionKind): BranchActionItemId | null {
  switch (kind) {
    case 'checkout':
      return 'checkout'
    case 'pull':
      return 'pull'
    case 'push':
      return 'push'
    case 'deleteBranch':
      return 'deleteBranch'
    case 'removeWorktree':
      return 'removeWorktree'
    case 'createWorktree':
      return null
  }
}

export function branchActionBusyItemId(repo: RepoState, branchName: string): BranchActionItemId | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || action.target !== branchName || !isBranchActionReason(action.reason)) return null
  return branchActionItemIdFromKind(branchActionKindFromReason(action.reason))
}

export function branchActionDisplayPhase(repo: RepoState, branchName: string): 'queued' | 'running' | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || action.target !== branchName) return null
  return action.phase
}
