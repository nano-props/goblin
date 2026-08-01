import type { RepoBranchActionKind } from '#/web/stores/workspaces/branch-action-types.ts'
export type RepoOperationPhase = 'idle' | 'queued' | 'running'
export type RepoBranchActionReason =
  'branch:pull' | 'branch:push' | 'branch:createWorktree' | 'branch:deleteBranch' | 'branch:removeWorktree'
export type RepoOperationReason =
  'fetch' | 'network' | 'pull' | 'push' | 'user-fetch' | 'workspace-refresh' | RepoBranchActionReason

export interface RepoOperationState {
  operationId: number
  phase: RepoOperationPhase
  reason: RepoOperationReason | null
  target: string | null
}

export interface RepoOperationTarget {
  key: string
  reason: RepoOperationReason
  target?: string | null
}

export interface RepoOperationsState {
  branchAction: RepoOperationState
}

export function isBranchActionReason(reason: RepoOperationReason | null): reason is RepoBranchActionReason {
  return typeof reason === 'string' && reason.startsWith('branch:')
}

export function branchActionKindFromReason(reason: RepoBranchActionReason): RepoBranchActionKind {
  return reason.slice('branch:'.length) as RepoBranchActionKind
}

export function idleOperation(): RepoOperationState {
  return {
    operationId: 0,
    phase: 'idle',
    reason: null,
    target: null,
  }
}

export function emptyWorkspaceOperations(): RepoOperationsState {
  return {
    branchAction: idleOperation(),
  }
}

export function markRepoOperationViews(
  operations: RepoOperationsState,
  operationId: number,
  targets: RepoOperationTarget[],
  phase: 'queued' | 'running',
  wasQueued = false,
): void {
  const target = targets.find((candidate) => candidate.key === 'branchAction')
  if (!target) return
  if (phase === 'running' && wasQueued) {
    if (operations.branchAction.operationId !== operationId || operations.branchAction.phase !== 'queued') return
  }
  if (phase === 'running') {
    startOperation(operations.branchAction, operationId, { reason: target.reason, target: target.target })
  } else {
    queueOperation(operations.branchAction, operationId, { reason: target.reason, target: target.target })
  }
}

export function settleRepoOperationViews(
  operations: RepoOperationsState,
  operationId: number,
  targets: RepoOperationTarget[],
  error: string | null,
): void {
  if (targets.some((target) => target.key === 'branchAction')) {
    settleOperation(operations.branchAction, operationId, { error })
  }
}

export function startOperation(
  operation: RepoOperationState,
  operationId: number,
  options?: { reason?: RepoOperationReason; target?: string | null },
): void {
  operation.operationId = operationId
  operation.phase = 'running'
  operation.reason = options?.reason ?? null
  operation.target = options?.target ?? null
}

export function queueOperation(
  operation: RepoOperationState,
  operationId: number,
  options?: { reason?: RepoOperationReason; target?: string | null },
): void {
  operation.operationId = operationId
  operation.phase = 'queued'
  operation.reason = options?.reason ?? null
  operation.target = options?.target ?? null
}

export function settleOperation(
  operation: RepoOperationState,
  operationId: number,
  _options?: { error?: string | null },
): boolean {
  if (operation.operationId !== operationId) return false
  operation.phase = 'idle'
  operation.reason = null
  operation.target = null
  return true
}

export function operationBusy(operation: RepoOperationState): boolean {
  return operation.phase !== 'idle'
}
