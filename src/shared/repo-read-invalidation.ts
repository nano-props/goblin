import { toSafeCanonicalWorkspaceId, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { isStringIn } from '#/shared/string-literals.ts'

export const REPO_READ_INVALIDATION_DOMAINS = ['metadata', 'worktree-status', 'operations'] as const

export type RepoReadInvalidationDomain = (typeof REPO_READ_INVALIDATION_DOMAINS)[number]

export interface RepoReadInvalidationEvent {
  type: 'repo-read-invalidated'
  repoId: WorkspaceId
  domain: RepoReadInvalidationDomain
}

export function isRepoReadInvalidationEvent(value: unknown): value is RepoReadInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  const repoId = Reflect.get(value, 'repoId')
  const domain = Reflect.get(value, 'domain')
  return (
    type === 'repo-read-invalidated' &&
    typeof repoId === 'string' &&
    toSafeCanonicalWorkspaceId(repoId) !== null &&
    isStringIn(REPO_READ_INVALIDATION_DOMAINS, domain)
  )
}
