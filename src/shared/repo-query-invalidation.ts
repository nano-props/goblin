import { toSafeCanonicalWorkspaceId, type WorkspaceId } from '#/shared/workspace-locator.ts'

export const REPO_QUERY_KINDS = ['repo-snapshot', 'repo-worktree-snapshot', 'repo-runtime'] as const

export type RepoQueryKind = (typeof REPO_QUERY_KINDS)[number]

export interface RepoQueryInvalidationEvent {
  type: 'repo-query-invalidated'
  repoId: WorkspaceId
  query: RepoQueryKind
}

export function isRepoQueryInvalidationEvent(value: unknown): value is RepoQueryInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<RepoQueryInvalidationEvent>
  return (
    event.type === 'repo-query-invalidated' &&
    toSafeCanonicalWorkspaceId(event.repoId) !== null &&
    REPO_QUERY_KINDS.includes(event.query as RepoQueryKind)
  )
}
