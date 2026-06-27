import { formatGraphqlError, getGitHubRepoRef, graphqlRequestResult } from '#/system/github/graphql.ts'
import { pullRequestsNodeLog } from '#/node/logger.ts'
import {
  isGitHubHostCoolingDown,
  markGitHubHostRateLimited,
  resetGitHubCooldownStateForTests,
} from '#/system/github/cooldown.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import {
  PULL_REQUEST_CACHE_TTL_MS,
  pullRequestCacheTtlMs,
  pullRequestCollectionCacheTtlMs,
} from '#/shared/pull-request-state.ts'
import type { GitHubRepoRef, GraphqlRequestError } from '#/system/github/graphql.ts'
import type { PullRequestFetchMode, PullRequestInfo } from '#/shared/git-types.ts'
import { canQueryGitHubHost } from '#/system/github-cli.ts'

interface PrCacheEntry {
  expiresAt: number
  mode: PullRequestFetchMode
  prs: Map<string, PullRequestInfo> | null
}

interface BranchPrCacheEntry {
  expiresAt: number
  mode: PullRequestFetchMode
  pr: PullRequestInfo | null
}

const prCache = new Map<string, PrCacheEntry>()
const branchPrCache = new Map<string, BranchPrCacheEntry>()
const pendingRepoRequests = new Map<string, Promise<Map<string, PullRequestInfo> | null>>()
const pendingBranchRequests = new Map<string, Promise<Map<string, PullRequestInfo> | null>>()
const loggedGraphqlErrors = new Map<string, number>()

interface GhPullRequest {
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

interface PullRequestsData {
  repository?: {
    pullRequests?: {
      nodes?: GhPullRequest[]
      pageInfo?: {
        hasNextPage?: boolean
        endCursor?: string | null
      }
    }
  } | null
}

type PullRequestsConnection = NonNullable<NonNullable<PullRequestsData['repository']>['pullRequests']>
type GhPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED'

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

function filterPullRequests(
  prs: Map<string, PullRequestInfo> | null,
  branchNames?: ReadonlySet<string>,
): Map<string, PullRequestInfo> | null {
  if (!prs || !branchNames) return prs
  const filtered = new Map<string, PullRequestInfo>()
  for (const branch of branchNames) {
    const pr = prs.get(branch)
    if (pr) filtered.set(branch, pr)
  }
  return filtered
}

function cacheFresh(expiresAt: number): boolean {
  return expiresAt > Date.now()
}

function cacheSatisfiesMode(cachedMode: PullRequestFetchMode, requestedMode: PullRequestFetchMode): boolean {
  return requestedMode === 'summary' || cachedMode === 'full'
}

function repoKey(repo: GitHubRepoRef): string {
  return `${repo.host}/${repo.owner}/${repo.name}`
}

function repoCacheKey(cwd: string, repo: GitHubRepoRef): string {
  return `${cwd}\0${repoKey(repo)}`
}

function branchCacheKey(cwd: string, repo: GitHubRepoRef, branch: string, mode: PullRequestFetchMode): string {
  return `${repoCacheKey(cwd, repo)}\0${branch}\0${mode}`
}

function repoRequestKey(cwd: string, repo: GitHubRepoRef, mode: PullRequestFetchMode): string {
  return `${repoCacheKey(cwd, repo)}\0${mode}`
}

async function hasPullRequestQueryCapability(repo: GitHubRepoRef, signal?: AbortSignal): Promise<boolean> {
  return canQueryGitHubHost(repo.host, signal)
}

const signalIds = new WeakMap<AbortSignal, number>()
let nextSignalId = 1

function pendingRequestKey(key: string, signal?: AbortSignal): string {
  if (!signal) return key
  let id = signalIds.get(signal)
  if (id === undefined) {
    id = nextSignalId++
    signalIds.set(signal, id)
  }
  return `${key}\0signal:${id}`
}

function getCachedBranchPullRequest(
  cwd: string,
  repo: GitHubRepoRef,
  branch: string,
  mode: PullRequestFetchMode,
): { hit: boolean; pr: PullRequestInfo | null } {
  const cached = prCache.get(repoCacheKey(cwd, repo))
  if (cached && cacheFresh(cached.expiresAt) && cacheSatisfiesMode(cached.mode, mode)) {
    const pr = cached.prs?.get(branch)
    if (pr) return { hit: true, pr }
  }

  const branchCacheKeys =
    mode === 'summary'
      ? [branchCacheKey(cwd, repo, branch, 'summary'), branchCacheKey(cwd, repo, branch, 'full')]
      : [branchCacheKey(cwd, repo, branch, mode)]
  for (const key of branchCacheKeys) {
    const branchCached = branchPrCache.get(key)
    if (branchCached && cacheFresh(branchCached.expiresAt) && cacheSatisfiesMode(branchCached.mode, mode)) {
      return { hit: true, pr: branchCached.pr }
    }
  }
  return { hit: false, pr: null }
}

function cacheBranchPullRequest(
  cwd: string,
  repo: GitHubRepoRef,
  branch: string,
  mode: PullRequestFetchMode,
  pr: PullRequestInfo | null,
): void {
  branchPrCache.set(branchCacheKey(cwd, repo, branch, mode), {
    expiresAt: Date.now() + pullRequestCacheTtlMs(mode, pr),
    mode,
    pr,
  })
}

const PULL_REQUESTS_QUERY = `
query GoblinPullRequests(
  $owner: String!,
  $repo: String!,
  $states: [PullRequestState!],
  $headRefName: String,
  $limit: Int!,
  $after: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: $states,
      headRefName: $headRefName,
      first: $limit,
      after: $after,
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        number
        title
        url
        state
        isDraft
        createdAt
        mergedAt
        author {
          login
        }
        baseRefName
        headRefName
        isCrossRepository
        reviewDecision
        mergeable
        mergeStateStatus
        statusCheckRollup: commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  checkRunCountsByState {
                    state
                    count
                  }
                  statusContextCountsByState {
                    state
                    count
                  }
                }
              }
            }
          }
        }
        headRepositoryOwner {
          login
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`

const PULL_REQUESTS_SUMMARY_QUERY = `
query GoblinPullRequests(
  $owner: String!,
  $repo: String!,
  $states: [PullRequestState!],
  $headRefName: String,
  $limit: Int!,
  $after: String
) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      states: $states,
      headRefName: $headRefName,
      first: $limit,
      after: $after,
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        number
        title
        url
        state
        isDraft
        createdAt
        mergedAt
        author {
          login
        }
        baseRefName
        headRefName
        isCrossRepository
        headRepositoryOwner {
          login
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`

async function queryPullRequests(
  cwd: string,
  repo: GitHubRepoRef,
  options: {
    headBranch?: string
    limit: number
    mode: PullRequestFetchMode
    signal?: AbortSignal
    states?: GhPullRequestState[]
  },
): Promise<PullRequestInfo[] | null> {
  const results: PullRequestInfo[] = []
  let after: string | null = null
  while (results.length < options.limit) {
    const remaining = options.limit - results.length
    const response = await graphqlRequestResult<PullRequestsData>(
      cwd,
      repo,
      options.mode === 'summary' ? PULL_REQUESTS_SUMMARY_QUERY : PULL_REQUESTS_QUERY,
      {
        owner: repo.owner,
        repo: repo.name,
        states: options.states ?? ['OPEN', 'CLOSED', 'MERGED'],
        headRefName: options.headBranch,
        limit: Math.min(remaining, 100),
        after,
      },
      'GoblinPullRequests',
      options.signal,
    )
    if (!response.ok) {
      const message = formatGraphqlError(response.error)
      if (response.error.code === 'RATE_LIMITED') {
        markGitHubHostRateLimited(repo.host)
        if (!options.signal?.aborted) logGraphqlError(response.error)
        return null
      }
      if (!options.signal?.aborted) logGraphqlError(response.error)
      throw new Error(message)
    }
    if (!response.data.repository?.pullRequests) return null
    const connection: PullRequestsConnection = response.data.repository.pullRequests
    for (const node of connection.nodes ?? []) {
      const pr = normalizeGhPullRequest(node)
      if (pr) results.push(pr)
    }
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break
    after = connection.pageInfo.endCursor
  }
  return results
}

function logGraphqlError(error: GraphqlRequestError): void {
  const key = `${error.host}:${error.operationName}:${error.code}:${error.status ?? 'unknown'}`
  const lastLoggedAt = loggedGraphqlErrors.get(key) ?? 0
  if (Date.now() - lastLoggedAt < PULL_REQUEST_CACHE_TTL_MS) return
  loggedGraphqlErrors.set(key, Date.now())
  try {
    pullRequestsNodeLog.warn(formatGraphqlError(error))
  } catch {}
}

async function queryRepoPullRequests(
  cwd: string,
  repo: GitHubRepoRef,
  mode: PullRequestFetchMode,
  signal?: AbortSignal,
): Promise<PullRequestInfo[] | null> {
  const openPrs = await queryPullRequests(cwd, repo, { states: ['OPEN'], limit: 200, mode, signal })
  if (!openPrs) return null
  if (mode === 'summary') return openPrs
  if (signal?.aborted) return null

  // Closed and merged PRs are only supplemental history. Querying open PRs
  // separately prevents a busy repository's recent closed PRs from pushing
  // older-but-still-open PRs past the repo-wide limit.
  const historicalPrs = await queryPullRequests(cwd, repo, {
    states: ['CLOSED', 'MERGED'],
    limit: 200,
    mode,
    signal,
  })
  return historicalPrs ? [...openPrs, ...historicalPrs] : openPrs
}

function mapPullRequestsByBranch(prs: PullRequestInfo[]): Map<string, PullRequestInfo> {
  const byBranch = new Map<string, PullRequestInfo>()
  for (const pr of prs) {
    // A fork PR can use a head ref name that collides with a local branch.
    // Until the UI can show the owner/repo context, keep branch rows scoped
    // to PRs whose head branch belongs to this repository.
    if (pr.isCrossRepository) continue
    const branch = pr.headRefName
    if (!branch) continue
    byBranch.set(branch, pickPullRequest(byBranch.get(branch), pr))
  }
  return byBranch
}

// gh api graphql --hostname doesn't need to run from a git repo — it uses
// the globally-configured gh auth. Use a stable directory for gh commands
// and keep the scopeId (local path or remote ID) for cache isolation only.
const ghWorkingDirectory = process.cwd()

async function fetchRepoPullRequestMap(
  scopeId: string,
  repo: GitHubRepoRef,
  mode: PullRequestFetchMode,
  signal?: AbortSignal,
): Promise<Map<string, PullRequestInfo> | null> {
  if (signal?.aborted) return null
  const prs = await queryRepoPullRequests(ghWorkingDirectory, repo, mode, signal)
  if (!prs) return null
  const byBranch = mapPullRequestsByBranch(prs)
  prCache.set(repoCacheKey(scopeId, repo), {
    expiresAt: Date.now() + pullRequestCollectionCacheTtlMs(mode, byBranch.values()),
    mode,
    prs: byBranch,
  })
  return byBranch
}

async function fetchSingleBranchPullRequestMap(
  scopeId: string,
  repo: GitHubRepoRef,
  branch: string,
  mode: PullRequestFetchMode,
  signal?: AbortSignal,
): Promise<Map<string, PullRequestInfo> | null> {
  const prs = await queryPullRequests(ghWorkingDirectory, repo, { headBranch: branch, limit: 20, mode, signal })
  if (!prs) return null
  const byBranch = mapPullRequestsByBranch(prs)
  cacheBranchPullRequest(scopeId, repo, branch, mode, byBranch.get(branch) ?? null)
  return byBranch
}

export async function getBranchPullRequestsForRepoRef(
  scopeId: string,
  repo: GitHubRepoRef,
  branchNames?: ReadonlySet<string>,
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
): Promise<Map<string, PullRequestInfo> | null> {
  const mode = options?.mode ?? 'full'
  const singleBranch = branchNames?.size === 1 ? Array.from(branchNames)[0] : undefined
  try {
    const cached = prCache.get(repoCacheKey(scopeId, repo))
    if (!singleBranch && cached && cacheFresh(cached.expiresAt) && cacheSatisfiesMode(cached.mode, mode)) {
      return filterPullRequests(cached.prs, branchNames)
    }
    if (isGitHubHostCoolingDown(repo.host)) return null
    if (singleBranch) {
      const cached = getCachedBranchPullRequest(scopeId, repo, singleBranch, mode)
      if (cached.hit) {
        return cached.pr ? new Map([[singleBranch, cached.pr]]) : new Map()
      }
      if (!(await hasPullRequestQueryCapability(repo, options?.signal))) return null

      const key = pendingRequestKey(branchCacheKey(scopeId, repo, singleBranch, mode), options?.signal)
      const existing = pendingBranchRequests.get(key)
      const byBranch = existing ?? fetchSingleBranchPullRequestMap(scopeId, repo, singleBranch, mode, options?.signal)
      if (!existing) pendingBranchRequests.set(key, byBranch)
      try {
        return await byBranch
      } finally {
        if (pendingBranchRequests.get(key) === byBranch) pendingBranchRequests.delete(key)
      }
    }

    const key = pendingRequestKey(repoRequestKey(scopeId, repo, mode), options?.signal)
    if (!(await hasPullRequestQueryCapability(repo, options?.signal))) return null
    const existing = pendingRepoRequests.get(key)
    const byBranch = existing ?? fetchRepoPullRequestMap(scopeId, repo, mode, options?.signal)
    if (!existing) pendingRepoRequests.set(key, byBranch)
    try {
      return filterPullRequests(await byBranch, branchNames)
    } finally {
      if (pendingRepoRequests.get(key) === byBranch) pendingRepoRequests.delete(key)
    }
  } catch (err) {
    if (options?.signal?.aborted) return null
    if (!singleBranch) {
      const key = repoCacheKey(scopeId, repo)
      const current = prCache.get(key)
      if (!current || !cacheFresh(current.expiresAt) || current.prs === null) {
        prCache.set(key, { expiresAt: Date.now() + PULL_REQUEST_CACHE_TTL_MS, mode, prs: null })
      }
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export async function getBranchPullRequests(
  cwd: string,
  branchNames?: ReadonlySet<string>,
  options?: { mode?: PullRequestFetchMode; signal?: AbortSignal },
): Promise<Map<string, PullRequestInfo> | null> {
  const singleBranch = branchNames?.size === 1 ? Array.from(branchNames)[0] : undefined
  const repo = await getGitHubRepoRef(cwd, { branch: singleBranch, signal: options?.signal })
  if (!repo) return null
  return await getBranchPullRequestsForRepoRef(cwd, repo, branchNames, options)
}

export function resetPullRequestCachesForTests(): void {
  prCache.clear()
  branchPrCache.clear()
  pendingRepoRequests.clear()
  pendingBranchRequests.clear()
  loggedGraphqlErrors.clear()
  resetGitHubCooldownStateForTests()
}

export async function getBranchPullRequest(
  cwd: string,
  branch: string,
  options?: { signal?: AbortSignal },
): Promise<PullRequestInfo | null> {
  if (options?.signal?.aborted) return null
  if (!isSafeBranchName(branch)) return null
  try {
    const repo = await getGitHubRepoRef(cwd, { branch, signal: options?.signal })
    if (!repo) return null
    const cached = getCachedBranchPullRequest(cwd, repo, branch, 'full')
    if (cached.hit) return cached.pr
    if (isGitHubHostCoolingDown(repo.host)) return null
    if (!(await hasPullRequestQueryCapability(repo, options?.signal))) return null
    const key = pendingRequestKey(branchCacheKey(cwd, repo, branch, 'full'), options?.signal)
    const existing = pendingBranchRequests.get(key)
    const byBranch = existing ?? fetchSingleBranchPullRequestMap(cwd, repo, branch, 'full', options?.signal)
    if (!existing) pendingBranchRequests.set(key, byBranch)
    try {
      return (await byBranch)?.get(branch) ?? null
    } finally {
      if (pendingBranchRequests.get(key) === byBranch) pendingBranchRequests.delete(key)
    }
  } catch {
    return null
  }
}
