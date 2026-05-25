export type RepoOperationPhase = 'idle' | 'queued' | 'running'
export type RepoBranchActionReason =
  | 'branch:checkout'
  | 'branch:pull'
  | 'branch:push'
  | 'branch:createWorktree'
  | 'branch:deleteBranch'
  | 'branch:removeWorktree'
export type RepoPullRequestReason = 'summary' | 'full'
export type RepoOperationReason =
  | 'background-fetch'
  | 'fetch'
  | 'network'
  | 'log'
  | 'pull'
  | 'push'
  | 'snapshot'
  | 'status'
  | 'pullRequests'
  | 'user-fetch'
  | RepoPullRequestReason
  | RepoBranchActionReason

export interface RepoOperationState {
  operationId: number
  phase: RepoOperationPhase
  reason: RepoOperationReason | null
  target: string | null
  startedAt: number | null
  settledAt: number | null
  error: string | null
}

export function idleOperation(): RepoOperationState {
  return {
    operationId: 0,
    phase: 'idle',
    reason: null,
    target: null,
    startedAt: null,
    settledAt: null,
    error: null,
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
  operation.startedAt = Date.now()
  operation.settledAt = null
  operation.error = null
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
  operation.startedAt = null
  operation.settledAt = null
  operation.error = null
}

export function settleOperation(
  operation: RepoOperationState,
  operationId: number,
  options?: { error?: string | null },
): boolean {
  if (operation.operationId !== operationId) return false
  operation.phase = 'idle'
  operation.target = null
  operation.settledAt = Date.now()
  operation.error = options?.error ?? null
  return true
}

export function operationBusy(operation: RepoOperationState): boolean {
  return operation.phase !== 'idle'
}
