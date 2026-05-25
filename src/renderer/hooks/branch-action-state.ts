import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

export type BranchActionItemId =
  | 'copyPatch'
  | 'checkout'
  | 'pull'
  | 'push'
  | 'github'
  | 'terminal'
  | 'editor'
  | 'deleteBranch'
  | 'removeWorktree'

export function isBranchActionBlocked(repo: RepoState): boolean {
  return resourceBusy(repo.resources.branchAction)
}

export function branchActionItemIdFromKind(kind: RepoBranchActionKind | null): BranchActionItemId | null {
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
    case null:
      return null
  }
}

export function branchActionItemIdFromResource(repo: RepoState, branchName: string): BranchActionItemId | null {
  const action = repo.resources.branchAction
  if (!resourceBusy(action)) return null
  if (action.target !== branchName) return null
  return branchActionItemIdFromKind(action.kind)
}

export function branchActionItemIdFromOperation(repo: RepoState, branchName: string): BranchActionItemId | null {
  return branchActionItemIdFromResource(repo, branchName)
}
