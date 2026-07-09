import { CancelledError } from '@tanstack/react-query'

export class RepoOperationCancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'RepoOperationCancelledError'
  }
}

function hasErrorName(err: unknown, name: string): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === name
}

export function isExpectedRepoOperationCancellation(err: unknown): boolean {
  if (err instanceof RepoOperationCancelledError) return true
  if (err instanceof CancelledError) return true
  return hasErrorName(err, 'AbortError')
}
