import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'

export class RepoMembershipReadConflictError extends Error {
  constructor() {
    super(REPO_MEMBERSHIP_READ_CONFLICT_KEY)
    this.name = 'RepoMembershipReadConflictError'
  }
}

export function isRepoMembershipReadConflictError(error: unknown): error is RepoMembershipReadConflictError {
  return error instanceof RepoMembershipReadConflictError
}
