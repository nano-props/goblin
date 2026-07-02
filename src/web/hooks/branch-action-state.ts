import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import { branchActionKindFromReason, isBranchActionReason } from '#/web/stores/repos/operations.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
export type BranchActionItemId =
  | 'status'
  | 'history'
  | 'changes'
  | 'files'
  | 'copyPatch'
  | 'pull'
  | 'push'
  | 'deleteBranch'
  | 'removeWorktree'

export interface BranchCopyPatchAction {
  label: string
  title?: string
  disabled: boolean
  busy?: boolean
  visible: boolean
  // The boolean lets the caller gate the in-context "Copied" affordance
  // on whether the patch actually landed on the clipboard. The failure
  // toast is surfaced by the action dispatcher itself.
  onSelect: () => boolean | Promise<boolean> | void | Promise<void>
}

export interface BranchActionRepo {
  id: RepoState['id']
  instanceId: RepoState['instanceId']
  data: Pick<RepoState['data'], 'currentBranch' | 'status' | 'worktreesByPath'>
  operations: Pick<RepoState['operations'], 'branchAction'>
  remote: Pick<
    RepoState['remote'],
    'lifecycle' | 'hasRemotes' | 'hasBrowserRemote' | 'hasGitHubRemote' | 'browserRemoteProvider' | 'remoteProviders'
  >
}

export function isBranchActionBlocked(repo: Pick<BranchActionRepo, 'operations'>): boolean {
  return repo.operations.branchAction.phase !== 'idle'
}

export function branchActionItemIdFromKind(kind: RepoBranchActionKind): BranchActionItemId | null {
  switch (kind) {
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

export function branchActionBusyItemId(
  repo: Pick<BranchActionRepo, 'operations'>,
  branchName: string,
): BranchActionItemId | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || action.target !== branchName || !isBranchActionReason(action.reason)) return null
  return branchActionItemIdFromKind(branchActionKindFromReason(action.reason))
}

export function branchActionDisplayPhase(
  repo: Pick<BranchActionRepo, 'operations'>,
  branchName: string,
): 'queued' | 'running' | null {
  const action = repo.operations.branchAction
  if (action.phase === 'idle' || action.target !== branchName) return null
  return action.phase
}
