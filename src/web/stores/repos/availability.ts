import type { RepoState } from '#/web/stores/repos/types.ts'
type RepoAvailabilityTarget = Pick<RepoState, 'availability' | 'remote'>

const UNAVAILABLE_REASONS = new Set([
  'error.path-not-found',
  'error.path-not-directory',
  'error.path-permission-denied',
  'error.not-git-repo',
  'error.ssh-config-changed',
])

export function isRepoUnavailableReason(message: string): boolean {
  return UNAVAILABLE_REASONS.has(message)
}

export function markRepoAvailable(repo: Pick<RepoState, 'availability'>): void {
  repo.availability = { phase: 'available' }
}

export function markRepoUnavailable(repo: RepoAvailabilityTarget, reason: string): void {
  repo.availability = { phase: 'unavailable', reason, checkedAt: Date.now() }
  repo.remote.fetchFailed = false
  repo.remote.fetchError = null
}
