import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const execaMock = vi.hoisted(() => vi.fn())

vi.mock('execa', async () => {
  const actual = await vi.importActual<typeof import('execa')>('execa')
  return { ...actual, execa: execaMock }
})

vi.mock('#/system/github-cli.ts', () => ({
  buildGitHubCliPath: vi.fn(() => process.env.PATH ?? ''),
}))

import {
  formatGraphqlError,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_TIMEOUT_MS,
  graphqlRequestResult,
  parseGitHubRemoteUrl,
  type GraphqlRequestError,
} from '#/system/github/graphql.ts'

const repo = { host: 'github.com', owner: 'acme', name: 'repo' }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  execaMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GitHub GraphQL transport', () => {
  test('uses the configured GitHub API timeout', () => {
    expect(GITHUB_API_TIMEOUT_MS).toBe(17_000)
  })
})

describe('GitHub repo reference parsing', () => {
  test('parses https remotes', () => {
    expect(parseGitHubRemoteUrl('https://github.com/acme/repo.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'repo',
    })
  })

  test('parses ssh and scp-like remotes', () => {
    expect(parseGitHubRemoteUrl('ssh://git@github.example.com/acme/repo.git')).toEqual({
      host: 'github.example.com',
      owner: 'acme',
      name: 'repo',
    })
    expect(parseGitHubRemoteUrl('git@github.com:acme/repo.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'repo',
    })
  })

  test('ignores GitLab remotes', () => {
    expect(parseGitHubRemoteUrl('https://gitlab.com/acme/repo.git')).toBeNull()
    expect(parseGitHubRemoteUrl('git@gitlab.example.com:acme/repo.git')).toBeNull()
  })

  test('ignores unknown remotes', () => {
    expect(parseGitHubRemoteUrl('https://code.example.com/acme/repo.git')).toBeNull()
  })

  test('prefers the branch upstream GitHub remote over origin', async () => {
    vi.resetModules()
    vi.doMock('#/system/git/remote.ts', async () => {
      const actual = await vi.importActual<typeof import('#/system/git/remote.ts')>('#/system/git/remote.ts')
      return {
        ...actual,
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'origin', fetchUrl: 'git@github.com:me/fork.git', pushUrl: 'git@github.com:me/fork.git' },
          { name: 'upstream', fetchUrl: 'git@github.com:acme/repo.git', pushUrl: 'git@github.com:acme/repo.git' },
        ]),
        getUpstreamParts: vi.fn().mockResolvedValue({ remote: 'upstream', branch: 'main' }),
      }
    })
    const { getGitHubRepoRef: getFreshGitHubRepoRef } = await import('#/system/github/graphql.ts')

    await expect(getFreshGitHubRepoRef('/tmp/repo', { branch: 'feature' })).resolves.toEqual({
      host: 'github.com',
      owner: 'acme',
      name: 'repo',
    })
  })

  test('falls back to origin when the selected upstream is not a GitHub remote', async () => {
    vi.resetModules()
    vi.doMock('#/system/git/remote.ts', async () => {
      const actual = await vi.importActual<typeof import('#/system/git/remote.ts')>('#/system/git/remote.ts')
      return {
        ...actual,
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'origin', fetchUrl: 'git@github.com:me/fork.git', pushUrl: 'git@github.com:me/fork.git' },
          { name: 'local', fetchUrl: '/tmp/local.git', pushUrl: '/tmp/local.git' },
        ]),
        getUpstreamParts: vi.fn().mockResolvedValue({ remote: 'local', branch: 'main' }),
      }
    })
    const { getGitHubRepoRef: getFreshGitHubRepoRef } = await import('#/system/github/graphql.ts')

    await expect(getFreshGitHubRepoRef('/tmp/repo', { branch: 'feature' })).resolves.toEqual({
      host: 'github.com',
      owner: 'me',
      name: 'fork',
    })
  })
})

describe('graphqlRequestResult transport', () => {
  test('returns data and omits undefined variables', async () => {
    let requestBody: unknown
    execaMock.mockImplementationOnce(async (_cmd, _args, options) => {
      requestBody = JSON.parse(String(options?.input))
      return { stdout: JSON.stringify({ data: { ok: true } }) }
    })

    const result = await graphqlRequestResult<{ ok: boolean }>(
      '/tmp/repo',
      repo,
      'query Test($owner: String!) { viewer { login } }',
      { owner: 'acme', skip: undefined },
      'Test',
    )

    expect(result).toEqual({ ok: true, data: { ok: true } })
    expect(requestBody).toEqual({
      query: 'query Test($owner: String!) { viewer { login } }',
      variables: { owner: 'acme' },
      operationName: 'Test',
    })
  })

  test('classifies CLI rate limits', async () => {
    execaMock.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { stderr: 'gh: API rate limit exceeded (HTTP 403)' }))

    const result = await graphqlRequestResult('/tmp/repo', repo, 'query Test { viewer { login } }', {}, 'Test')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED')
      expect(result.error.status).toBe(403)
      expect(result.error.retryable).toBe(true)
    }
  })

  test('classifies GraphQL errors', async () => {
    execaMock.mockResolvedValueOnce({ stdout: JSON.stringify({ errors: [{ message: 'Field not found' }] }) })

    const result = await graphqlRequestResult('/tmp/repo', repo, 'query Test { nope }', {}, 'Test')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('GRAPHQL_ERROR')
      expect(result.error.message).toBe('Field not found')
      expect(result.error.retryable).toBe(false)
    }
  })

  test('limits concurrent GraphQL requests', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    execaMock.mockImplementation(async () => {
      calls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await sleep(10)
      active -= 1
      return { stdout: JSON.stringify({ data: { ok: true } }) }
    })

    const results = await Promise.all(
      Array.from({ length: GITHUB_API_CONCURRENCY + 1 }, (_, index) =>
        graphqlRequestResult<{ ok: boolean }>('/tmp/repo', repo, 'query Test { viewer { login } }', {}, `Test${index}`),
      ),
    )

    expect(calls).toBe(GITHUB_API_CONCURRENCY + 1)
    expect(maxActive).toBe(GITHUB_API_CONCURRENCY)
    expect(results.every((result) => result.ok)).toBe(true)
  })

  test('formats structured errors for logs', () => {
    const error: GraphqlRequestError = {
      code: 'UNAUTHORIZED',
      message: 'Bad credentials',
      host: 'github.com',
      operationName: 'Test',
      retryable: false,
      status: 401,
    }

    expect(formatGraphqlError(error)).toBe('Test failed on github.com: UNAUTHORIZED HTTP 401 (non-retryable) - Bad credentials')
  })
})
