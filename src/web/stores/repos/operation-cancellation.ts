import { CancelledError } from '@tanstack/react-query'

export class RepoOperationCancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'RepoOperationCancelledError'
  }
}

function isRepoOperationCancelledReason(reason: unknown): boolean {
  return reason instanceof RepoOperationCancelledError
}

export function isExpectedRepoOperationCancellation(err: unknown, operationSignal?: AbortSignal | null): boolean {
  if (err instanceof RepoOperationCancelledError) return true
  if (err instanceof CancelledError) return true
  if (operationSignal?.aborted && isRepoOperationCancelledReason(operationSignal.reason)) return true
  return false
}
