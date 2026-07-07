import type {
  RepoOperationCancellationReason,
  RepoOperationFailureReason,
  RepoOperationsSnapshot,
  RepoServerOperationKind,
  RepoServerOperationSource,
  RepoServerOperationState,
  RepoServerOperationTarget,
} from '#/shared/api-types.ts'

interface BeginRepoServerOperationInput {
  id?: string
  repoId?: string | null
  repoInstanceId?: string | null
  kind: RepoServerOperationKind
  source: RepoServerOperationSource
  target?: RepoServerOperationTarget | null
  deadlineAt?: number | null
  canCancelUnderlying?: boolean
}

interface ListRepoServerOperationsOptions {
  repoId?: string
  includeSettled?: boolean
}

const MAX_SETTLED_OPERATIONS = 100

let nextOperationId = 1
const operations = new Map<string, RepoServerOperationState>()

function freshOperationId(): string {
  return `repo-op-${nextOperationId++}`
}

export function createRepoServerOperationId(): string {
  return freshOperationId()
}

function cloneOperation(state: RepoServerOperationState): RepoServerOperationState {
  return {
    ...state,
    target: state.target ? { ...state.target } : null,
    error: state.error ? { ...state.error } : null,
    cancellation: { ...state.cancellation },
  }
}

function operationFailureReasonForMessage(
  message: string | null | undefined,
  cancellationReason: RepoOperationCancellationReason | null,
): RepoOperationFailureReason | null {
  if (cancellationReason) return cancellationReason
  if (message === 'cancelled') return 'caller-abort'
  return null
}

function sortedOperations(states: RepoServerOperationState[]): RepoServerOperationState[] {
  return [...states].sort((a, b) => {
    const aTime = a.settledAt ?? a.startedAt ?? a.queuedAt
    const bTime = b.settledAt ?? b.startedAt ?? b.queuedAt
    return bTime - aTime
  })
}

function pruneSettledOperations(): void {
  const settled = sortedOperations(
    [...operations.values()].filter((operation) => operation.phase === 'done' || operation.phase === 'failed'),
  )
  for (const operation of settled.slice(MAX_SETTLED_OPERATIONS)) {
    operations.delete(operation.id)
  }
}

export function beginRepoServerOperation(input: BeginRepoServerOperationInput): RepoServerOperationState {
  const now = Date.now()
  const id = input.id ?? freshOperationId()
  const operation: RepoServerOperationState = {
    id,
    repoId: input.repoId ?? null,
    repoInstanceId: input.repoInstanceId ?? null,
    kind: input.kind,
    phase: 'queued',
    source: input.source,
    target: input.target ? { ...input.target } : null,
    queuedAt: now,
    startedAt: null,
    deadlineAt: input.deadlineAt ?? null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: input.canCancelUnderlying ?? true,
  }
  operations.set(id, operation)
  return cloneOperation(operation)
}

export function startRepoServerOperation(id: string): RepoServerOperationState | null {
  const operation = operations.get(id)
  if (!operation) return null
  operation.phase = operation.cancellation.underlyingRequested ? 'cancelling' : 'running'
  operation.startedAt = Date.now()
  return cloneOperation(operation)
}

export function requestRepoServerOperationCancel(
  id: string,
  reason: RepoOperationCancellationReason,
): RepoServerOperationState | null {
  const operation = operations.get(id)
  if (!operation) return null
  operation.cancellation.underlyingRequested = true
  operation.cancellation.reason = reason
  operation.cancellation.requestedAt = Date.now()
  if (operation.phase === 'queued' || operation.phase === 'running') operation.phase = 'cancelling'
  return cloneOperation(operation)
}

export function recordRepoServerOperationWaitCancellation(
  id: string,
  reason: RepoOperationCancellationReason,
): RepoServerOperationState | null {
  const operation = operations.get(id)
  if (!operation) return null
  operation.cancellation.waitCancelledCount += 1
  operation.cancellation.lastWaitCancelledAt = Date.now()
  operation.cancellation.lastWaitCancellationReason = reason
  return cloneOperation(operation)
}

export function settleRepoServerOperation(
  id: string,
  result: { ok: boolean; message?: string },
): RepoServerOperationState | null {
  const operation = operations.get(id)
  if (!operation) return null
  const cancellationReason = operation.cancellation.reason
  operation.phase = result.ok ? 'done' : 'failed'
  operation.settledAt = Date.now()
  operation.error = result.ok
    ? null
    : {
        message: result.message ?? 'error.failed-read-repo',
        reason: operationFailureReasonForMessage(result.message, cancellationReason),
      }
  pruneSettledOperations()
  return cloneOperation(operation)
}

export function listRepoServerOperations(
  options: ListRepoServerOperationsOptions = {},
): RepoServerOperationState[] {
  const includeSettled = options.includeSettled === true
  return sortedOperations(
    [...operations.values()].filter((operation) => {
      if (options.repoId && operation.repoId !== options.repoId) return false
      if (!includeSettled && (operation.phase === 'done' || operation.phase === 'failed')) return false
      return true
    }),
  ).map(cloneOperation)
}

export function getRepoOperationsSnapshot(options: ListRepoServerOperationsOptions = {}): RepoOperationsSnapshot {
  return {
    operations: listRepoServerOperations(options),
    loadedAt: Date.now(),
  }
}

export function resetRepoServerOperationRegistryForTests(): void {
  operations.clear()
  nextOperationId = 1
}
