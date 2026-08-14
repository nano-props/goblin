import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import type { RepoReadFailure } from '#/web/repos/read-failure.ts'

export interface RepoReadCondition {
  kind: 'membership-changing' | 'stale' | 'unavailable'
  message: string
  retrying: boolean
  retry?: () => void
}

export function combineRepoReadFailures(failures: readonly RepoReadFailure[]): RepoReadCondition | null {
  const firstFailure = failures[0]
  if (!firstFailure) return null

  const message = failures.every((failure) => failure.message === firstFailure.message)
    ? firstFailure.message
    : 'error.failed-read-repo'
  const kind =
    message === REPO_MEMBERSHIP_READ_CONFLICT_KEY
      ? 'membership-changing'
      : failures.every((failure) => failure.stale)
        ? 'stale'
        : 'unavailable'
  const idleRetries: Array<() => void> = []
  let hasRetry = false
  for (const { retry, retrying } of failures) {
    if (!retry) continue
    hasRetry = true
    if (!retrying) idleRetries.push(retry)
  }

  return {
    kind,
    message,
    retrying: hasRetry && idleRetries.length === 0,
    retry: hasRetry
      ? () => {
          for (const retry of idleRetries) retry()
        }
      : undefined,
  }
}
