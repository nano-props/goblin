import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  formatGraphqlError,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_TIMEOUT_MS,
  githubGraphqlEndpoint,
  graphqlRequestResult,
  parseGitHubRemoteUrl,
  tokenFromEnv,
  type GraphqlRequestError,
} from '#/main/github/graphql.ts'

const TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'] as const
const repo = { host: 'github.com', owner: 'acme', name: 'repo' }

let originalFetch: typeof globalThis.fetch
let originalEnv: Partial<Record<(typeof TOKEN_ENV_KEYS)[number], string | undefined>>

function mockFetch(handler: (...args: Parameters<typeof fetch>) => Promise<Response>): void {
  globalThis.fetch = handler as unknown as typeof fetch
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  originalFetch = globalThis.fetch
  originalEnv = Object.fromEntries(TOKEN_ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of TOKEN_ENV_KEYS) delete process.env[key]
  process.env.GH_TOKEN = 'test-token'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of TOKEN_ENV_KEYS) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

test('uses the configured GitHub API timeout', () => {
  expect(GITHUB_API_TIMEOUT_MS).toBe(17_000)
})

describe('parseGitHubRemoteUrl', () => {
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
})

describe('githubGraphqlEndpoint', () => {
  test('uses the public GitHub GraphQL endpoint for github.com', () => {
    expect(githubGraphqlEndpoint('github.com')).toBe('https://api.github.com/graphql')
  })

  test('uses the GHES GraphQL endpoint for custom hosts', () => {
    expect(githubGraphqlEndpoint('github.example.com')).toBe('https://github.example.com/api/graphql')
  })
})

describe('tokenFromEnv', () => {
  test('uses enterprise tokens for custom hosts without using public tokens', () => {
    process.env.GH_TOKEN = 'public-token'
    process.env.GITHUB_TOKEN = 'public-token'
    process.env.GH_ENTERPRISE_TOKEN = 'enterprise-token'
    process.env.GITHUB_ENTERPRISE_TOKEN = 'enterprise-token'

    expect(tokenFromEnv('github.example.com')).toBe('enterprise-token')
  })

  test('uses public GitHub tokens for github.com and ghe.com hosts', () => {
    process.env.GH_TOKEN = 'public-token'

    expect(tokenFromEnv('github.com')).toBe('public-token')
    expect(tokenFromEnv('acme.ghe.com')).toBe('public-token')
  })

  test('does not use enterprise tokens for public GitHub hosts', () => {
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    process.env.GH_ENTERPRISE_TOKEN = 'enterprise-token'

    expect(tokenFromEnv('github.com')).toBeNull()
    expect(tokenFromEnv('acme.ghe.com')).toBeNull()
  })
})

describe('graphqlRequestResult', () => {
  test('returns data and omits undefined variables', async () => {
    let requestBody: unknown
    mockFetch(async (...args) => {
      const init = args[1]
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
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

  test('classifies HTTP rate limits', async () => {
    mockFetch(
      async () =>
        new Response('rate limited', {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    )

    const result = await graphqlRequestResult('/tmp/repo', repo, 'query Test { viewer { login } }', {}, 'Test')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED')
      expect(result.error.status).toBe(403)
      expect(result.error.retryable).toBe(true)
    }
  })

  test('classifies GraphQL errors', async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ errors: [{ message: 'Field not found' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const result = await graphqlRequestResult('/tmp/repo', repo, 'query Test { nope }', {}, 'Test')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('GRAPHQL_ERROR')
      expect(result.error.message).toBe('Field not found')
      expect(result.error.retryable).toBe(false)
    }
  })

  test('limits concurrent GraphQL fetches', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    mockFetch(async () => {
      calls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await sleep(10)
      active -= 1
      return new Response(JSON.stringify({ data: { ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
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

    expect(formatGraphqlError(error)).toBe(
      'Test failed on github.com: UNAUTHORIZED HTTP 401 (non-retryable) - Bad credentials',
    )
  })

})
