import type { PullRequestInfo } from '#/shared/git-types.ts'

export interface GhPullRequest {
  number?: number
  title?: string
  url?: string
  state?: string
  isDraft?: boolean
  createdAt?: string
  mergedAt?: string | null
  author?: { login?: string } | null
  baseRefName?: string
  headRefName?: string
  headRepositoryOwner?: { login?: string } | null
  isCrossRepository?: boolean
  reviewDecision?: string | null
  mergeable?: string
  mergeStateStatus?: string | null
  statusCheckRollup?: {
    nodes?: Array<{
      commit?: {
        statusCheckRollup?: {
          contexts?: {
            checkRunCountsByState?: Array<{ state?: string; count?: number }>
            statusContextCountsByState?: Array<{ state?: string; count?: number }>
          }
        } | null
      }
    }>
  }
}

export function normalizeGhPullRequest(pr: GhPullRequest): PullRequestInfo | null {
  if (typeof pr.number !== 'number' || !pr.url || !pr.title) return null
  const rawState = pr.state?.toUpperCase()
  const state: PullRequestInfo['state'] =
    pr.mergedAt != null || rawState === 'MERGED' ? 'merged' : rawState === 'OPEN' ? 'open' : 'closed'
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state,
    isDraft: pr.isDraft === true,
    createdAt: pr.createdAt || undefined,
    author: pr.author?.login || undefined,
    baseRefName: pr.baseRefName || undefined,
    headRefName: pr.headRefName || undefined,
    headRepositoryOwner: pr.headRepositoryOwner?.login || undefined,
    isCrossRepository: pr.isCrossRepository === true,
    checks: summarizeChecks(pr.statusCheckRollup),
    reviewDecision: normalizeReviewDecision(pr.reviewDecision),
    mergeable: normalizeMergeable(pr),
  }
}

function normalizeReviewDecision(value: string | null | undefined): PullRequestInfo['reviewDecision'] {
  if (value === 'APPROVED' || value === 'CHANGES_REQUESTED' || value === 'REVIEW_REQUIRED') return value
  return null
}

function normalizeMergeable(pr: GhPullRequest): PullRequestInfo['mergeable'] | undefined {
  if (pr.mergeStateStatus === 'DIRTY') return 'CONFLICTING'
  if (pr.mergeable === 'MERGEABLE' || pr.mergeable === 'CONFLICTING') return pr.mergeable
  if (pr.mergeable === 'UNKNOWN') return 'UNKNOWN'
  return undefined
}

function summarizeChecks(statusCheckRollup: GhPullRequest['statusCheckRollup']): PullRequestInfo['checks'] | undefined {
  const contexts = statusCheckRollup?.nodes?.[0]?.commit?.statusCheckRollup?.contexts
  if (!contexts) return undefined
  let passing = 0
  let failing = 0
  let pending = 0
  for (const item of contexts.checkRunCountsByState ?? []) {
    const count = typeof item.count === 'number' ? item.count : 0
    if (item.state === 'NEUTRAL' || item.state === 'SKIPPED' || item.state === 'SUCCESS') passing += count
    else if (
      item.state === 'ACTION_REQUIRED' ||
      item.state === 'CANCELLED' ||
      item.state === 'FAILURE' ||
      item.state === 'TIMED_OUT'
    )
      failing += count
    else pending += count
  }
  for (const item of contexts.statusContextCountsByState ?? []) {
    const count = typeof item.count === 'number' ? item.count : 0
    if (item.state === 'SUCCESS') passing += count
    else if (item.state === 'ERROR' || item.state === 'FAILURE') failing += count
    else pending += count
  }
  const total = passing + failing + pending
  return total > 0 ? { total, passing, failing, pending } : undefined
}

function stateRank(pr: PullRequestInfo): number {
  if (pr.state === 'open') return 0
  if (pr.state === 'merged') return 1
  return 2
}

export function pickPullRequest(existing: PullRequestInfo | undefined, next: PullRequestInfo): PullRequestInfo {
  if (!existing) return next
  return stateRank(next) < stateRank(existing) ? next : existing
}
