import type { RepoBranchActionKind } from '#/renderer/stores/repos/branch-action-types.ts'

export type RepoOperationPhase = 'idle' | 'queued' | 'running'
export type RepoOperationKey =
  | 'fetch'
  | 'snapshot'
  | 'status'
  | 'pullRequests'
  | 'branchAction'
  | `log:${string}`
  | `pullRequest:${string}`
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

export interface RepoOperationTarget {
  key: RepoOperationKey
  reason: RepoOperationReason
  target?: string | null
}

export interface RepoOperationsState {
  fetch: RepoOperationState
  snapshot: RepoOperationState
  status: RepoOperationState
  pullRequests: RepoOperationState
  branchAction: RepoOperationState
  logsByBranch: Record<string, RepoOperationState>
  pullRequestsByBranch: Record<string, RepoOperationState>
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
    snapshot: idleOperation(),
    status: idleOperation(),
    pullRequests: idleOperation(),
    branchAction: idleOperation(),
    logsByBranch: {},
    pullRequestsByBranch: {},
  }
}

function isLogOperationKey(key: RepoOperationKey): key is `log:${string}` {
  return key.startsWith('log:')
}

function isPullRequestOperationKey(key: RepoOperationKey): key is `pullRequest:${string}` {
  return key.startsWith('pullRequest:')
}

function operationForKey(operations: RepoOperationsState, key: RepoOperationKey): RepoOperationState {
  if (isLogOperationKey(key)) return (operations.logsByBranch[key.slice('log:'.length)] ??= idleOperation())
  if (isPullRequestOperationKey(key)) {
    return (operations.pullRequestsByBranch[key.slice('pullRequest:'.length)] ??= idleOperation())
  }
  switch (key) {
    case 'fetch':
      return operations.fetch
    case 'snapshot':
      return operations.snapshot
    case 'status':
      return operations.status
    case 'pullRequests':
      return operations.pullRequests
    case 'branchAction':
      return operations.branchAction
  }
  const exhaustive: never = key
  return exhaustive
}

function readOperationForKey(operations: RepoOperationsState, key: RepoOperationKey): RepoOperationState {
  if (isLogOperationKey(key)) return operations.logsByBranch[key.slice('log:'.length)] ?? idleOperation()
  if (isPullRequestOperationKey(key)) return operations.pullRequestsByBranch[key.slice('pullRequest:'.length)] ?? idleOperation()
  switch (key) {
    case 'fetch':
      return operations.fetch
    case 'snapshot':
      return operations.snapshot
    case 'status':
      return operations.status
    case 'pullRequests':
      return operations.pullRequests
    case 'branchAction':
      return operations.branchAction
  }
  const exhaustive: never = key
  return exhaustive
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
      return operation.operationId === operationId && operation.phase === 'queued'
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
    settleOperation(readOperationForKey(operations, target.key), operationId, { error })
  }
}

export function pruneRepoOperationViewsForBranches(operations: RepoOperationsState, validBranches: Set<string>): void {
  for (const branch of Object.keys(operations.logsByBranch)) {
    if (!validBranches.has(branch)) delete operations.logsByBranch[branch]
  }
  for (const branch of Object.keys(operations.pullRequestsByBranch)) {
    if (!validBranches.has(branch)) delete operations.pullRequestsByBranch[branch]
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
