export const REPO_QUERY_KINDS = ['repo-snapshot', 'repo-runtime'] as const

export type RepoQueryKind = (typeof REPO_QUERY_KINDS)[number]

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
    REPO_QUERY_KINDS.includes(event.query as RepoQueryKind)
  )
}
