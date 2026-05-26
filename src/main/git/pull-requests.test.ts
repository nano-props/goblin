import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { execaSync } from 'execa'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getBranchPullRequest,
  getBranchPullRequests,
  normalizeGhPullRequest,
  pickPullRequest,
} from '#/main/git/pull-requests.ts'

const TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'] as const

let originalFetch: typeof globalThis.fetch
let originalEnv: Partial<Record<(typeof TOKEN_ENV_KEYS)[number], string | undefined>>
let tmp: string | null = null

function initGitHubRepo(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'gbl-pr-test-'))
  execaSync('git', ['init', tmp], { stdio: 'ignore' })
  execaSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/repo.git'], { cwd: tmp, stdio: 'ignore' })
  return tmp
}

function git(cwd: string, ...args: string[]): string {
  return execaSync('git', args, { cwd }).stdout.trim()
}

function pullRequestNode(number: number, headRefName: string) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName,
    isCrossRepository: false,
  }
}

function graphqlPullRequests(nodes: unknown[]): Response {
  return new Response(
    JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  originalEnv = Object.fromEntries(TOKEN_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of TOKEN_ENV_KEYS) delete process.env[key]
  process.env.GH_TOKEN = 'test-token'
})

afterEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  for (const key of TOKEN_ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('normalizeGhPullRequest', () => {
  test('normalizes open pull requests', () => {
    expect(
      normalizeGhPullRequest({
        number: 12,
        title: 'Feature',
        url: 'https://github.com/acme/repo/pull/12',
        state: 'OPEN',
        isDraft: true,
        createdAt: '2026-05-20T10:00:00Z',
        author: { login: 'octocat' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRepositoryOwner: { login: 'acme' },
        isCrossRepository: false,
      }),
    ).toEqual({
      number: 12,
      title: 'Feature',
      url: 'https://github.com/acme/repo/pull/12',
      state: 'open',
      isDraft: true,
      createdAt: '2026-05-20T10:00:00Z',
      author: 'octocat',
      baseRefName: 'main',
      headRefName: 'feature',
      headRepositoryOwner: 'acme',
      isCrossRepository: false,
      checks: undefined,
      reviewDecision: null,
      mergeable: undefined,
    })
  })

  test('summarizes checks, review, and mergeability', () => {
    expect(
      normalizeGhPullRequest({
        number: 12,
        title: 'Feature',
        url: 'https://github.com/acme/repo/pull/12',
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        mergeable: 'MERGEABLE',
        statusCheckRollup: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    checkRunCountsByState: [
                      { state: 'SUCCESS', count: 2 },
                      { state: 'FAILURE', count: 1 },
                      { state: 'PENDING', count: 1 },
                    ],
                    statusContextCountsByState: [
                      { state: 'SUCCESS', count: 1 },
                      { state: 'PENDING', count: 1 },
                    ],
                  },
                },
              },
            },
          ],
        },
      })?.checks,
    ).toEqual({ total: 6, passing: 3, failing: 1, pending: 2 })
  })

  test('uses mergedAt as the merged signal', () => {
    expect(
      normalizeGhPullRequest({
        number: 12,
        title: 'Feature',
        url: 'https://github.com/acme/repo/pull/12',
        state: 'CLOSED',
        mergedAt: '2026-05-20T10:00:00Z',
      })?.state,
    ).toBe('merged')
  })

  test('uses dirty merge state as a conflict signal', () => {
    expect(
      normalizeGhPullRequest({
        number: 12,
        title: 'Feature',
        url: 'https://github.com/acme/repo/pull/12',
        state: 'OPEN',
        mergeable: 'UNKNOWN',
        mergeStateStatus: 'DIRTY',
      })?.mergeable,
    ).toBe('CONFLICTING')
  })

  test('rejects incomplete records', () => {
    expect(normalizeGhPullRequest({ number: 12, title: 'Feature' })).toBeNull()
  })
})

describe('pickPullRequest', () => {
  test('prefers open over merged and merged over closed', () => {
    const closed = {
      number: 1,
      title: 'Closed',
      url: 'https://github.com/acme/repo/pull/1',
      state: 'closed' as const,
    }
    const merged = {
      number: 2,
      title: 'Merged',
      url: 'https://github.com/acme/repo/pull/2',
      state: 'merged' as const,
    }
    const open = {
      number: 3,
      title: 'Open',
      url: 'https://github.com/acme/repo/pull/3',
      state: 'open' as const,
    }

    expect(pickPullRequest(closed, merged)).toBe(merged)
    expect(pickPullRequest(merged, open)).toBe(open)
  })
})

describe('getBranchPullRequest', () => {
  test('uses the branch upstream GitHub remote for single-branch queries', async () => {
    const repo = initGitHubRepo()
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/me/fork.git')
    git(repo, 'remote', 'add', 'upstream', 'https://github.com/acme/repo.git')
    git(repo, 'config', 'branch.feature.remote', 'upstream')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')
    const queriedRepos: Array<{ owner?: string; repo?: string; headRefName?: string }> = []
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const init = args[1]
      const body = JSON.parse(String(init?.body)) as {
        variables?: { owner?: string; repo?: string; headRefName?: string }
      }
      queriedRepos.push(body.variables ?? {})
      return graphqlPullRequests([pullRequestNode(42, 'feature')])
    }) as typeof fetch

    const result = await getBranchPullRequests(repo, new Set(['feature']), { mode: 'summary' })

    expect(result?.get('feature')?.number).toBe(42)
    expect(queriedRepos[0]).toMatchObject({ owner: 'acme', repo: 'repo', headRefName: 'feature' })
  })

  test('keeps single-branch PR cache entries isolated by selected GitHub repo', async () => {
    const repo = initGitHubRepo()
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/me/fork.git')
    git(repo, 'remote', 'add', 'upstream', 'https://github.com/acme/repo.git')
    git(repo, 'config', 'branch.feature.remote', 'upstream')
    git(repo, 'config', 'branch.feature.merge', 'refs/heads/main')
    const queriedRepos: Array<{ owner?: string; repo?: string; headRefName?: string }> = []
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const init = args[1]
      const body = JSON.parse(String(init?.body)) as {
        variables?: { owner?: string; repo?: string; headRefName?: string }
      }
      const variables = body.variables ?? {}
      queriedRepos.push(variables)
      return graphqlPullRequests([
        pullRequestNode(variables.headRefName === 'feature' ? 42 : 7, variables.headRefName ?? ''),
      ])
    }) as typeof fetch

    const upstreamBranch = await getBranchPullRequests(repo, new Set(['feature']), { mode: 'summary' })
    const originBranch = await getBranchPullRequests(repo, new Set(['other']), { mode: 'summary' })

    expect(upstreamBranch?.get('feature')?.number).toBe(42)
    expect(originBranch?.get('other')?.number).toBe(7)
    expect(queriedRepos).toEqual([
      expect.objectContaining({ owner: 'acme', repo: 'repo', headRefName: 'feature' }),
      expect.objectContaining({ owner: 'me', repo: 'fork', headRefName: 'other' }),
    ])
  })

  test('does not treat a repo-wide cache miss as a definitive single-branch miss', async () => {
    const repo = initGitHubRepo()
    const queriedHeads: Array<string | undefined> = []
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const init = args[1]
      const body = JSON.parse(String(init?.body)) as { variables?: { headRefName?: string; states?: string[] } }
      const headRefName = body.variables?.headRefName
      queriedHeads.push(headRefName)
      if (headRefName === 'hidden') return graphqlPullRequests([pullRequestNode(99, 'hidden')])
      if (body.variables?.states?.includes('OPEN')) return graphqlPullRequests([pullRequestNode(1, 'cached')])
      return graphqlPullRequests([])
    }) as typeof fetch

    const repoWide = await getBranchPullRequests(repo, undefined, { mode: 'full' })
    const hidden = await getBranchPullRequest(repo, 'hidden')

    expect(repoWide?.get('cached')?.number).toBe(1)
    expect(hidden?.number).toBe(99)
    expect(queriedHeads).toContain('hidden')
  })
})

describe('getBranchPullRequests cancellation', () => {
  test('does not let a signaled caller abort an unsignaled caller', async () => {
    const repo = initGitHubRepo()
    const ctrl = new AbortController()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let releaseFirstFetch!: () => void
    let fetchCalls = 0
    const firstFetchStarted = new Promise<void>((resolve) => {
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        const init = args[1]
        fetchCalls += 1
        if (fetchCalls === 1) {
          resolve()
          const release = new Promise<void>((resolveFirstFetch) => {
            releaseFirstFetch = resolveFirstFetch
          })
          const aborted = new Promise<never>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true,
            })
          })
          await Promise.race([release, aborted])
        }
        return graphqlPullRequests([pullRequestNode(7, 'feature/a')])
      }) as typeof fetch
    })

    const first = getBranchPullRequests(repo, undefined, { mode: 'summary', signal: ctrl.signal })
    await firstFetchStarted
    const second = getBranchPullRequests(repo, undefined, { mode: 'summary' })
    ctrl.abort()
    releaseFirstFetch()

    const [, secondResult] = await Promise.all([first, second])
    expect(secondResult?.get('feature/a')?.number).toBe(7)
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[pull-requests]'), expect.anything())
  })

  test('shares pending requests for callers using the same signal', async () => {
    const repo = initGitHubRepo()
    const ctrl = new AbortController()
    let releaseFetch!: () => void
    let fetchCalls = 0
    const firstFetchStarted = new Promise<void>((resolve) => {
      globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
        fetchCalls += 1
        resolve()
        await new Promise<void>((release) => {
          releaseFetch = release
        })
        return graphqlPullRequests([pullRequestNode(8, 'feature/shared')])
      }) as typeof fetch
    })

    const first = getBranchPullRequests(repo, undefined, { mode: 'summary', signal: ctrl.signal })
    await firstFetchStarted
    const second = getBranchPullRequests(repo, undefined, { mode: 'summary', signal: ctrl.signal })
    releaseFetch()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(fetchCalls).toBe(1)
    expect(firstResult?.get('feature/shared')?.number).toBe(8)
    expect(secondResult?.get('feature/shared')?.number).toBe(8)
  })

  test('stops full repo queries when aborted after open pull requests load', async () => {
    const repo = initGitHubRepo()
    const ctrl = new AbortController()
    let fetchCalls = 0
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
      fetchCalls += 1
      ctrl.abort()
      return graphqlPullRequests([pullRequestNode(9, 'feature/open')])
    }) as typeof fetch

    const result = await getBranchPullRequests(repo, undefined, { mode: 'full', signal: ctrl.signal })

    expect(result).toBeNull()
    expect(fetchCalls).toBe(1)
  })

  test('does not overwrite a successful repo cache when an unexpected refresh error occurs', async () => {
    const repo = initGitHubRepo()
    globalThis.fetch = (async () => graphqlPullRequests([pullRequestNode(3, 'cached')])) as unknown as typeof fetch
    const summary = await getBranchPullRequests(repo, undefined, { mode: 'summary' })
    expect(summary?.get('cached')?.number).toBe(3)

    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('logger unavailable')
    })
    globalThis.fetch = (async () =>
      new Response('', { status: 500, statusText: 'server down' })) as unknown as typeof fetch
    const failed = await getBranchPullRequests(repo, undefined, { mode: 'full' })
    vi.mocked(console.warn).mockRestore()
    const cached = await getBranchPullRequests(repo, undefined, { mode: 'summary' })

    expect(failed).toBeNull()
    expect(cached?.get('cached')?.number).toBe(3)
  })
})
