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
  workspaceRuntimeId: RepoState['workspaceRuntimeId']
  branchModel: Pick<RepoBranchReadModelData, 'currentBranch' | 'status' | 'worktreesByPath'>
  branchAction: RepoOperationState
  remote: Pick<
    RepoState['remote'],
    'lifecycle' | 'hasRemotes' | 'hasBrowserRemote' | 'hasGitHubRemote' | 'browserRemoteProvider' | 'remoteProviders'
  >
}

interface BranchActionLocalFallbackRepo {
  operations: Pick<RepoState['operations'], 'branchAction'>
}

export function isBranchActionBlocked(repo: Pick<BranchActionRepo, 'branchAction'>): boolean {
  return repo.branchAction.phase !== 'idle'
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

export function projectBranchActionOperation(
  fallback: RepoOperationState,
  operations: readonly RepoServerOperationState[] | undefined,
  branchName?: string | null,
): RepoOperationState {
  return branchActionOperationFromServer(fallback, operations, branchName)
}

export function projectBranchActionRepo<T extends BranchActionLocalFallbackRepo>(
  repo: T,
  operations: readonly RepoServerOperationState[] | undefined,
  branchName?: string | null,
): Omit<T, 'operations'> & { branchAction: RepoOperationState } {
  const { operations: localOperations, ...rest } = repo
  return {
    ...rest,
    branchAction: projectBranchActionOperation(localOperations.branchAction, operations, branchName),
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
  repo: Pick<BranchActionRepo, 'branchAction'>,
  branchName: string,
): BranchActionItemId | null {
  const action = repo.branchAction
  if (action.phase === 'idle' || action.target !== branchName || !isBranchActionReason(action.reason)) return null
  return branchActionItemIdFromKind(branchActionKindFromReason(action.reason))
}

export function branchActionDisplayPhase(
  repo: Pick<BranchActionRepo, 'branchAction'>,
  branchName: string,
): 'queued' | 'running' | null {
  const action = repo.branchAction
  if (action.phase === 'idle' || action.target !== branchName) return null
  return action.phase
}
