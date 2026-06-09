import type { PullRequestInfo } from '#/shared/git-types.ts'
export const PULL_REQUEST_CACHE_TTL_MS = 30_000
export const PULL_REQUEST_TRANSIENT_CACHE_TTL_MS = 2_000
export const PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS = 2_000
export const PULL_REQUEST_UNKNOWN_RETRY_LIMIT = 3

export function pullRequestMergeStatusPending(
  pullRequest: Pick<PullRequestInfo, 'mergeable'> | null | undefined,
): boolean {
  return pullRequest?.mergeable === 'UNKNOWN'
}

export function pullRequestCacheTtlMs(
  mode: 'summary' | 'full',
  pullRequest: Pick<PullRequestInfo, 'mergeable'> | null | undefined,
): number {
  return mode === 'full' && pullRequestMergeStatusPending(pullRequest)
    ? PULL_REQUEST_TRANSIENT_CACHE_TTL_MS
    : PULL_REQUEST_CACHE_TTL_MS
}

export function pullRequestCollectionCacheTtlMs(
  mode: 'summary' | 'full',
  pullRequests: Iterable<Pick<PullRequestInfo, 'mergeable'> | null | undefined>,
): number {
  if (mode === 'full') {
    for (const pullRequest of pullRequests) {
      if (pullRequestMergeStatusPending(pullRequest)) return PULL_REQUEST_TRANSIENT_CACHE_TTL_MS
    }
  }
  return PULL_REQUEST_CACHE_TTL_MS
}
