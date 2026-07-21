import type { RepoServerOperationState } from '#/shared/api-types.ts'

export function repoServerOperationActive(operation: Pick<RepoServerOperationState, 'phase'>): boolean {
  return operation.phase === 'queued' || operation.phase === 'running' || operation.phase === 'cancelling'
}
