import type {
  RepoOperationCancellationReason,
  RepoOperationFailureReason,
  RepoServerOperationState,
} from '#/shared/api-types.ts'

export interface RepoWriteOperationListOptions {
  includeSettled?: boolean
  workspaceRuntimeId?: string
}

export function repoWriteOperationFailureReason(
  message: string | null | undefined,
  cancellationReason: RepoOperationCancellationReason | null,
): RepoOperationFailureReason | null {
  // This records why the operation stopped, not whether earlier domain steps
  // changed repository state. Confirmed partial success stays in the result
  // and its recovery notice instead of creating another activity phase.
  if (cancellationReason) return cancellationReason
  if (message === 'cancelled') return 'caller-abort'
  return null
}

export function isSettledRepoWriteOperation(operation: RepoServerOperationState): boolean {
  return operation.phase === 'done' || operation.phase === 'failed'
}

export function repoWriteOperationTimestamp(operation: RepoServerOperationState): number {
  return operation.settledAt ?? operation.startedAt ?? operation.queuedAt
}

export function projectRepoWriteOperations(
  states: readonly RepoServerOperationState[],
  options: RepoWriteOperationListOptions,
): RepoServerOperationState[] {
  const includeSettled = options.includeSettled === true
  return states
    .filter((operation) => {
      if (
        options.workspaceRuntimeId &&
        operation.workspaceRuntimeId &&
        operation.workspaceRuntimeId !== options.workspaceRuntimeId
      ) {
        return false
      }
      return includeSettled || !isSettledRepoWriteOperation(operation)
    })
    .sort((a, b) => repoWriteOperationTimestamp(b) - repoWriteOperationTimestamp(a))
    .map(cloneRepoWriteOperation)
}

function cloneRepoWriteOperation(state: RepoServerOperationState): RepoServerOperationState {
  return {
    ...state,
    target: state.target ? { ...state.target } : null,
    error: state.error ? { ...state.error } : null,
    cancellation: { ...state.cancellation },
  }
}
