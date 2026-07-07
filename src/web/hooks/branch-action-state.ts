import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
import {
  branchActionKindFromReason,
  isBranchActionReason,
  type RepoOperationState,
} from '#/web/stores/repos/operations.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
export type BranchActionItemId =
  'status' | 'history' | 'changes' | 'files' | 'copyPatch' | 'pull' | 'push' | 'deleteBranch' | 'removeWorktree'

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
  branchModel: Pick<RepoBranchReadModelData, 'currentBranch' | 'status' | 'worktreesByPath'>
  operations: Pick<RepoState['operations'], 'branchAction'>
  remote: Pick<
    RepoState['remote'],
    'lifecycle' | 'hasRemotes' | 'hasBrowserRemote' | 'hasGitHubRemote' | 'browserRemoteProvider' | 'remoteProviders'
  >
}

export function isBranchActionBlocked(repo: Pick<BranchActionRepo, 'operations'>): boolean {
  return repo.operations.branchAction.phase !== 'idle'
}

export function isActiveServerBranchAction(operation: RepoServerOperationState): boolean {
  return (
    serverBranchActionReason(operation) !== null &&
    (operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'cancelling')
  )
}

export function serverBranchActionReason(operation: RepoServerOperationState): RepoOperationState['reason'] {
  switch (operation.kind) {
    case 'pull':
      return 'branch:pull'
    case 'push':
      return 'branch:push'
    case 'create-worktree':
      return 'branch:createWorktree'
    case 'delete-branch':
      return 'branch:deleteBranch'
    case 'remove-worktree':
      return 'branch:removeWorktree'
    default:
      return null
  }
}

export function branchActionOperationFromServer(
  fallback: RepoOperationState,
  operations: readonly RepoServerOperationState[] | undefined,
  branchName?: string | null,
): RepoOperationState {
  const operation = operations?.find((candidate) => {
    if (!isActiveServerBranchAction(candidate)) return false
    if (!branchName) return true
    return candidate.target?.branch === branchName
  })
  if (!operation) return fallback
  return {
    operationId: operation.queuedAt,
    phase: operation.phase === 'queued' ? 'queued' : 'running',
    reason: serverBranchActionReason(operation),
    target: operation.target?.branch ?? null,
    startedAt: operation.startedAt,
    settledAt: operation.settledAt,
    error: operation.error?.message ?? null,
  }
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
