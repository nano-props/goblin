import { execFile } from 'node:child_process'
import { isSafeBranchName } from '#/shared/refnames.ts'
import type { PullRequestInfo } from '#/main/git/types.ts'

const GH_TIMEOUT_MS = 8_000
const GH_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
const PR_CACHE_TTL_MS = 30_000
const prCache = new Map<string, { expiresAt: number; prs: Map<string, PullRequestInfo> | null }>()

interface GhPullRequest {
  number?: number
  title?: string
  url?: string
  state?: string
  isDraft?: boolean
  mergedAt?: string | null
  closedAt?: string | null
  baseRefName?: string
  headRefName?: string
}

function gh(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        cwd,
        encoding: 'utf-8',
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: '1',
          PATH: [process.env.PATH, GH_PATH].filter(Boolean).join(':'),
        },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(typeof stdout === 'string' ? stdout.trimEnd() : String(stdout))
      },
    )
  })
}

export function normalizeGhPullRequest(pr: GhPullRequest): PullRequestInfo | null {
  if (typeof pr.number !== 'number' || !pr.url || !pr.title) return null
  const rawState = pr.state?.toUpperCase()
  const state: PullRequestInfo['state'] =
    pr.mergedAt || rawState === 'MERGED' ? 'merged' : rawState === 'OPEN' ? 'open' : 'closed'
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state,
    isDraft: pr.isDraft === true,
    baseRefName: pr.baseRefName || undefined,
    headRefName: pr.headRefName || undefined,
  }
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

function parsePullRequests(output: string): PullRequestInfo[] {
  const raw: unknown = JSON.parse(output)
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const pr = normalizeGhPullRequest(item as GhPullRequest)
    return pr ? [pr] : []
  })
}

async function canUseGh(cwd: string): Promise<boolean> {
  try {
    await gh(cwd, ['auth', 'status'])
    return true
  } catch {
    return false
  }
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

export async function getBranchPullRequests(
  cwd: string,
  branchNames?: ReadonlySet<string>,
): Promise<Map<string, PullRequestInfo> | null> {
  const cached = prCache.get(cwd)
  if (cached && cached.expiresAt > Date.now()) return filterPullRequests(cached.prs, branchNames)

  try {
    if (!(await canUseGh(cwd))) {
      prCache.set(cwd, { expiresAt: Date.now() + PR_CACHE_TTL_MS, prs: null })
      return null
    }
    const output = await gh(cwd, [
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      '200',
      '--json',
      'number,title,url,state,isDraft,mergedAt,closedAt,baseRefName,headRefName',
    ])
    const byBranch = new Map<string, PullRequestInfo>()
    for (const pr of parsePullRequests(output)) {
      const branch = pr.headRefName
      if (!branch) continue
      byBranch.set(branch, pickPullRequest(byBranch.get(branch), pr))
    }
    prCache.set(cwd, { expiresAt: Date.now() + PR_CACHE_TTL_MS, prs: byBranch })
    return filterPullRequests(byBranch, branchNames)
  } catch {
    return null
  }
}

export async function getBranchPullRequest(cwd: string, branch: string): Promise<PullRequestInfo | null> {
  if (!isSafeBranchName(branch)) return null
  try {
    if (!(await canUseGh(cwd))) return null
    const output = await gh(cwd, [
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '20',
      '--json',
      'number,title,url,state,isDraft,mergedAt,closedAt,baseRefName,headRefName',
    ])
    let picked: PullRequestInfo | null = null
    for (const pr of parsePullRequests(output)) {
      picked = pickPullRequest(picked ?? undefined, pr)
    }
    return picked
  } catch {
    return null
  }
}
