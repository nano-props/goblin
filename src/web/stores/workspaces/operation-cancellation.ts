import { CancelledError } from '@tanstack/query-core'
import { hasErrorCode } from '#/shared/error-code.ts'

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
  if (hasErrorCode(err, 'OUTCOME_UNCERTAIN')) return false
  if (err instanceof RepoOperationCancelledError) return true
  if (err instanceof CancelledError) return true
  if (operationSignal?.aborted && isRepoOperationCancelledReason(operationSignal.reason)) return true
  return false
}
