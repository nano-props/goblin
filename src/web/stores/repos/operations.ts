import type { RepoBranchActionKind } from '#/web/stores/repos/branch-action-types.ts'
export type RepoOperationPhase = 'idle' | 'queued' | 'running'
export type RepoOperationKey = 'fetch' | 'manualRefresh' | 'repoReadModel' | 'branchAction'
export type RepoBranchActionReason =
  'branch:pull' | 'branch:push' | 'branch:createWorktree' | 'branch:deleteBranch' | 'branch:removeWorktree'
export type RepoOperationReason =
  'fetch' | 'network' | 'pull' | 'push' | 'repo-read-model' | 'user-fetch' | 'manual-refresh' | RepoBranchActionReason

export interface RepoOperationState {
  operationId: number
  phase: RepoOperationPhase
  reason: RepoOperationReason | null
  target: string | null
  startedAt: number | null
  settledAt: number | null
  error: string | null
}

export interface RepoOperationTarget {
  key: string
  reason: RepoOperationReason
  target?: string | null
}

export interface RepoOperationsState {
  fetch: RepoOperationState
  manualRefresh: RepoOperationState
  repoReadModel: RepoOperationState
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
    startedAt: null,
    settledAt: null,
    error: null,
  }
}

export function emptyRepoOperations(): RepoOperationsState {
  return {
    fetch: idleOperation(),
    manualRefresh: idleOperation(),
    repoReadModel: idleOperation(),
    branchAction: idleOperation(),
  }
}

function operationForKey(operations: RepoOperationsState, key: string): RepoOperationState {
  switch (key as RepoOperationKey) {
    case 'fetch':
      return operations.fetch
    case 'manualRefresh':
      return operations.manualRefresh
    case 'repoReadModel':
      return operations.repoReadModel
    case 'branchAction':
      return operations.branchAction
  }
  return idleOperation()
}

function readOperationForKey(operations: RepoOperationsState, key: string): RepoOperationState | undefined {
  switch (key as RepoOperationKey) {
    case 'fetch':
      return operations.fetch
    case 'manualRefresh':
      return operations.manualRefresh
    case 'repoReadModel':
      return operations.repoReadModel
    case 'branchAction':
      return operations.branchAction
  }
  return undefined
}

export function markRepoOperationViews(
  operations: RepoOperationsState,
  operationId: number,
  targets: RepoOperationTarget[],
  phase: 'queued' | 'running',
  wasQueued = false,
): void {
  if (phase === 'running' && wasQueued) {
    const allTargetsQueuedForOperation = targets.every((target) => {
      const operation = readOperationForKey(operations, target.key)
      return operation?.operationId === operationId && operation?.phase === 'queued'
    })
    if (!allTargetsQueuedForOperation) return
  }
  for (const target of targets) {
    const operation = operationForKey(operations, target.key)
    if (phase === 'running') {
      startOperation(operation, operationId, { reason: target.reason, target: target.target })
    } else {
      queueOperation(operation, operationId, { reason: target.reason, target: target.target })
    }
  }
}

export function settleRepoOperationViews(
  operations: RepoOperationsState,
  operationId: number,
  targets: RepoOperationTarget[],
  error: string | null,
): void {
  for (const target of targets) {
    const operation = readOperationForKey(operations, target.key)
    if (operation) settleOperation(operation, operationId, { error })
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
