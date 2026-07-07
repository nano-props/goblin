export type RepoQueryKind = 'repo-snapshot'

export interface RepoQueryInvalidationEvent {
  type: 'repo-query-invalidated'
  repoId: string
  query: RepoQueryKind
}

export function isRepoQueryInvalidationEvent(value: unknown): value is RepoQueryInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<RepoQueryInvalidationEvent>
  return (
    event.type === 'repo-query-invalidated' &&
    typeof event.repoId === 'string' &&
    event.query === 'repo-snapshot'
  )
}
