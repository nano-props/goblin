import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getBranchPullRequest,
  getBranchPullRequests,
  normalizeGhPullRequest,
  pickPullRequest,
  resetPullRequestCachesForTests,
} from '#/system/git/pull-requests.ts'

const execaMock = vi.hoisted(() => vi.fn())
const canQueryGitHubHostMock = vi.hoisted(() => vi.fn())
const getGitHubRepoRefMock = vi.hoisted(() => vi.fn())

vi.mock('execa', async () => {
  const actual = await vi.importActual<typeof import('execa')>('execa')
  return {
    ...actual,
    execa: ((file: string, args?: readonly string[], options?: Record<string, unknown>) =>
      file === 'gh' ? execaMock(file, args, options) : actual.execa(file, args, options as any)) as typeof actual.execa,
  }
})

vi.mock('#/system/github-cli.ts', () => ({
  buildGitHubCliPath: vi.fn(() => process.env.PATH ?? ''),
  canQueryGitHubHost: vi.fn((host: string) => canQueryGitHubHostMock(host)),
}))

vi.mock('#/system/github/graphql.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/github/graphql.ts')>('#/system/github/graphql.ts')
  return {
    ...actual,
    getGitHubRepoRef: vi.fn((cwd: string, options?: unknown) => getGitHubRepoRefMock(cwd, options)),
  }
})

vi.mock('#/system/github/queue.ts', async () => {
  const actual = await vi.importActual<typeof import('#/system/github/queue.ts')>('#/system/github/queue.ts')
  return {
    ...actual,
    enqueueGitHubApiRequest: (task: () => Promise<unknown>) => task(),
  }
})

beforeEach(() => {
  execaMock.mockReset()
  canQueryGitHubHostMock.mockReset()
  getGitHubRepoRefMock.mockReset()
  canQueryGitHubHostMock.mockResolvedValue(true)
  getGitHubRepoRefMock.mockResolvedValue({ host: 'github.com', owner: 'acme', name: 'repo' })
  resetPullRequestCachesForTests()
})

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

function graphqlPullRequests(nodes: unknown[]) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequests: {
          nodes,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  })
}

function installGhGraphqlMock(handler: (payload: { variables?: Record<string, unknown> }) => string | Promise<string>): void {
  execaMock.mockImplementation(async (_cmd, _args, options) => ({ stdout: await handler(JSON.parse(String(options?.input))) }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pull request normalization', () => {
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
    ).toMatchObject({
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
    })
  })
})

describe('pull request selection', () => {
  test('prefers open over merged over closed', () => {
    const merged = { number: 1, title: 'Merged', url: 'https://example.com/1', state: 'merged' as const, isDraft: false }
    const open = { number: 2, title: 'Open', url: 'https://example.com/2', state: 'open' as const, isDraft: false }
    const closed = { number: 3, title: 'Closed', url: 'https://example.com/3', state: 'closed' as const, isDraft: false }

    expect(pickPullRequest(merged, open)).toBe(open)
    expect(pickPullRequest(open, closed)).toBe(open)
  })
})

describe('branch pull request lookup', () => {
  test('uses the selected GitHub repo for single-branch queries', async () => {
    const repo = '/tmp/repo'
    const queriedRepos: Array<{ owner?: string; repo?: string; headRefName?: string }> = []
    installGhGraphqlMock(async (body) => {
      queriedRepos.push((body.variables ?? {}) as { owner?: string; repo?: string; headRefName?: string })
      return graphqlPullRequests([pullRequestNode(42, 'feature')])
    })

    const result = await getBranchPullRequests(repo, new Set(['feature']), { mode: 'summary' })

    expect(result?.get('feature')?.number).toBe(42)
    expect(queriedRepos[0]).toMatchObject({ owner: 'acme', repo: 'repo', headRefName: 'feature' })
  })

  test('keeps single-branch PR cache entries isolated by selected GitHub repo', async () => {
    const repo = '/tmp/repo'
    getGitHubRepoRefMock.mockImplementation(async (_cwd: string, options?: { branch?: string }) =>
      options?.branch === 'feature'
        ? { host: 'github.com', owner: 'acme', name: 'repo' }
        : { host: 'github.com', owner: 'me', name: 'fork' },
    )
    const queriedRepos: Array<{ owner?: string; repo?: string; headRefName?: string }> = []
    installGhGraphqlMock(async (body) => {
      const variables = (body.variables ?? {}) as { owner?: string; repo?: string; headRefName?: string }
      queriedRepos.push(variables)
      return graphqlPullRequests([pullRequestNode(variables.headRefName === 'feature' ? 42 : 7, variables.headRefName ?? '')])
    })

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
    const repo = '/tmp/repo'
    const queriedHeads: Array<string | undefined> = []
    installGhGraphqlMock(async (body) => {
      const headRefName = body.variables?.headRefName as string | undefined
      const states = body.variables?.states as string[] | undefined
      queriedHeads.push(headRefName)
      if (headRefName === 'hidden') return graphqlPullRequests([pullRequestNode(99, 'hidden')])
      if (states?.includes('OPEN')) return graphqlPullRequests([pullRequestNode(1, 'cached')])
      return graphqlPullRequests([])
    })

    const repoWide = await getBranchPullRequests(repo, undefined, { mode: 'full' })
    const hidden = await getBranchPullRequest(repo, 'hidden')

    expect(repoWide?.get('cached')?.number).toBe(1)
    expect(hidden?.number).toBe(99)
    expect(queriedHeads).toContain('hidden')
  })

  test('skips single-branch pull request fetches when host capability is unavailable', async () => {
    const repo = '/tmp/repo'
    canQueryGitHubHostMock.mockResolvedValueOnce(false)

    const result = await getBranchPullRequest(repo, 'feature')

    expect(result).toBeNull()
    expect(execaMock).not.toHaveBeenCalled()
  })
})

describe('getBranchPullRequests request coordination', () => {
  test('does not let a signaled caller abort an unsignaled shared request', async () => {
    const repo = '/tmp/repo'
    const ctrl = new AbortController()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let releaseFirstFetch!: () => void
    let fetchCalls = 0
    const firstFetchStarted = new Promise<void>((resolve) => {
      execaMock.mockImplementation(async (_cmd, _args, options) => {
        fetchCalls += 1
        if (fetchCalls === 1) {
          resolve()
          const release = new Promise<void>((resolveFirstFetch) => {
            releaseFirstFetch = resolveFirstFetch
          })
          const aborted = new Promise<never>((_resolve, reject) => {
            options?.cancelSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true,
            })
          })
          await Promise.race([release, aborted])
        }
        return { stdout: graphqlPullRequests([pullRequestNode(7, 'feature/a')]) }
      })
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
    const repo = '/tmp/repo'
    const ctrl = new AbortController()
    let releaseFetch!: () => void
    let fetchCalls = 0
    const firstFetchStarted = new Promise<void>((resolve) => {
      execaMock.mockImplementation(async () => {
        fetchCalls += 1
        resolve()
        await new Promise<void>((release) => {
          releaseFetch = release
        })
        return { stdout: graphqlPullRequests([pullRequestNode(8, 'feature/shared')]) }
      })
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

  test('stops full-repo queries when aborted after open pull requests load', async () => {
    const repo = '/tmp/repo'
    const ctrl = new AbortController()
    let fetchCalls = 0
    execaMock.mockImplementation(async () => {
      fetchCalls += 1
      ctrl.abort()
      return { stdout: graphqlPullRequests([pullRequestNode(9, 'feature/open')]) }
    })

    const result = await getBranchPullRequests(repo, undefined, { mode: 'full', signal: ctrl.signal })

    expect(result).toBeNull()
    expect(fetchCalls).toBe(1)
  })

  test('does not overwrite a successful repo cache when an unexpected refresh error occurs', async () => {
    const repo = '/tmp/repo'
    execaMock.mockResolvedValueOnce({ stdout: graphqlPullRequests([pullRequestNode(3, 'cached')]) })
    const summary = await getBranchPullRequests(repo, undefined, { mode: 'summary' })
    expect(summary?.get('cached')?.number).toBe(3)

    vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('logger unavailable')
    })
    execaMock.mockRejectedValueOnce(Object.assign(new Error('server down'), { stderr: 'gh: server down (HTTP 500)' }))
    await expect(getBranchPullRequests(repo, undefined, { mode: 'full' })).rejects.toThrow(
      'GoblinPullRequests failed on github.com: HTTP_ERROR HTTP 500 (retryable) - gh: server down (HTTP 500)',
    )
    vi.mocked(console.warn).mockRestore()
    const cached = await getBranchPullRequests(repo, undefined, { mode: 'summary' })

    expect(cached?.get('cached')?.number).toBe(3)
  })

  test('skips repo-wide pull request fetches when host capability is unavailable', async () => {
    const repo = '/tmp/repo'
    canQueryGitHubHostMock.mockResolvedValueOnce(false)

    const result = await getBranchPullRequests(repo, undefined, { mode: 'full' })

    expect(result).toBeNull()
    expect(execaMock).not.toHaveBeenCalled()
  })

  test('backs off after GitHub secondary rate limits instead of retrying immediately', async () => {
    const repo = '/tmp/repo'
    execaMock.mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), {
        stderr:
          'gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)',
      }),
    )

    const first = await getBranchPullRequests(repo, new Set(['feature/rate-limit']), { mode: 'summary' })
    const second = await getBranchPullRequests(repo, new Set(['feature/rate-limit']), { mode: 'summary' })

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(execaMock).toHaveBeenCalledTimes(1)
  })
})
