import { execa } from 'execa'
import { getRemotes, getUpstreamParts, pickPreferredRemote } from '#/main/git/remote.ts'
import {
  enqueueGitHubApiRequest,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_INTERVAL_CAP,
  GITHUB_API_INTERVAL_MS,
} from '#/main/github/queue.ts'

export const GITHUB_API_TIMEOUT_MS = 17_000
export { GITHUB_API_CONCURRENCY, GITHUB_API_INTERVAL_CAP, GITHUB_API_INTERVAL_MS }

const GH_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
const TOKEN_CACHE_TTL_MS = 30_000
const TOKEN_MISS_CACHE_TTL_MS = 5_000
const tokenCache = new Map<string, { expiresAt: number; token: string | null }>()

export interface GitHubRepoRef {
  host: string
  owner: string
  name: string
}

export interface GitHubRepoRefOptions {
  branch?: string
  signal?: AbortSignal
}

interface GraphqlEnvelope<TData> {
  data?: TData
  errors?: unknown[]
}

export type GraphqlErrorCode =
  | 'NO_AUTH_TOKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'GRAPHQL_ERROR'
  | 'INVALID_JSON'
  | 'NO_DATA'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'

export interface GraphqlRequestError {
  code: GraphqlErrorCode
  message: string
  host: string
  operationName: string
  retryable: boolean
  status?: number
  graphqlErrors?: unknown[]
}

export type GraphqlRequestResult<TData> =
  | { ok: true; data: TData }
  | {
      ok: false
      error: GraphqlRequestError
    }

const TOKEN_ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'] as const

function gh(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    PATH: [process.env.PATH, GH_PATH].filter(Boolean).join(':'),
  }
  for (const key of TOKEN_ENV_KEYS) delete env[key]
  return execa('gh', args, {
    cwd,
    timeout: GITHUB_API_TIMEOUT_MS,
    forceKillAfterDelay: 500,
    cancelSignal: signal,
    maxBuffer: 1024 * 1024,
    env,
  }).then(({ stdout }) => stdout.trimEnd())
}

export function parseGitHubRemoteUrl(url: string): GitHubRepoRef | null {
  const sshUrl = url.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  const httpsUrl = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/)
  const scpUrl = url.match(/^(?:[^@]+@)?([^:/\s]+):([^/].*?)(?:\.git)?\/?$/)
  const match = sshUrl ?? httpsUrl ?? scpUrl
  if (!match) return null
  const path = match[2]?.replace(/\.git$/, '').replace(/\/$/, '') ?? ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 2 || !match[1]) return null
  return { host: match[1].toLowerCase(), owner: parts[0]!, name: parts[1]! }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    !!value &&
    typeof value === 'object' &&
    'aborted' in value &&
    'addEventListener' in value &&
    typeof (value as { addEventListener?: unknown }).addEventListener === 'function'
  )
}

function normalizeRepoRefOptions(options?: AbortSignal | GitHubRepoRefOptions): GitHubRepoRefOptions {
  if (!options) return {}
  return isAbortSignal(options) ? { signal: options } : options
}

function pickGitHubRepoRef(
  remotes: Array<{ name: string; repo: GitHubRepoRef }>,
  upstream?: { remote: string; branch: string } | null,
): GitHubRepoRef | null {
  return pickPreferredRemote(remotes, upstream)?.repo ?? null
}

export function githubGraphqlEndpoint(host: string): string {
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`
}

export function tokenFromEnv(host: string): string | null {
  const publicGitHubHost = host === 'github.com' || host.endsWith('.ghe.com')
  const candidates = publicGitHubHost
    ? [process.env.GH_TOKEN, process.env.GITHUB_TOKEN]
    : [process.env.GH_ENTERPRISE_TOKEN, process.env.GITHUB_ENTERPRISE_TOKEN]
  return candidates.find((token): token is string => typeof token === 'string' && token.length > 0) ?? null
}

export async function getGitHubRepoRef(
  cwd: string,
  options?: AbortSignal | GitHubRepoRefOptions,
): Promise<GitHubRepoRef | null> {
  const { branch, signal } = normalizeRepoRefOptions(options)
  try {
    const [allRemotes, upstream] = await Promise.all([
      getRemotes(cwd, signal),
      branch ? getUpstreamParts(cwd, branch, signal) : Promise.resolve(null),
    ])
    const remotes = allRemotes
      .map((remote) => ({ name: remote.name, repo: parseGitHubRemoteUrl(remote.url) }))
      .filter((remote): remote is { name: string; repo: GitHubRepoRef } => remote.repo !== null)
    return pickGitHubRepoRef(remotes, upstream)
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return null
    return null
  }
}

async function getAuthToken(cwd: string, host: string, signal?: AbortSignal): Promise<string | null> {
  const envToken = tokenFromEnv(host)
  if (envToken) return envToken

  const cached = tokenCache.get(host)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  try {
    const token = await gh(cwd, ['auth', 'token', '--hostname', host], signal)
    const value = token.trim() || null
    tokenCache.set(host, { expiresAt: Date.now() + TOKEN_CACHE_TTL_MS, token: value })
    return value
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return null
    tokenCache.set(host, { expiresAt: Date.now() + TOKEN_MISS_CACHE_TTL_MS, token: null })
    return null
  }
}

function compactVariables(variables: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined))
}

function graphqlError(
  repo: GitHubRepoRef,
  operationName: string,
  code: GraphqlErrorCode,
  message: string,
  options?: { retryable?: boolean; status?: number; graphqlErrors?: unknown[] },
): GraphqlRequestError {
  return {
    code,
    message,
    host: repo.host,
    operationName,
    retryable: options?.retryable ?? false,
    status: options?.status,
    graphqlErrors: options?.graphqlErrors,
  }
}

function graphqlErrorMessage(errors: unknown[]): string {
  const first = errors[0]
  if (first && typeof first === 'object' && 'message' in first) {
    const message = (first as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'GitHub GraphQL returned errors'
}

function httpErrorCode(response: Response): { code: GraphqlErrorCode; retryable: boolean } {
  if (response.status === 401) return { code: 'UNAUTHORIZED', retryable: false }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return { code: 'RATE_LIMITED', retryable: true }
  }
  if (response.status === 403) return { code: 'FORBIDDEN', retryable: false }
  if (response.status === 429) return { code: 'RATE_LIMITED', retryable: true }
  return { code: 'HTTP_ERROR', retryable: response.status >= 500 }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && (err.name === 'AbortError' || err.message === 'The operation was aborted.')
}

export function formatGraphqlError(error: GraphqlRequestError): string {
  const status = error.status ? ` HTTP ${error.status}` : ''
  const retryable = error.retryable ? 'retryable' : 'non-retryable'
  return `${error.operationName} failed on ${error.host}: ${error.code}${status} (${retryable}) - ${error.message}`
}

export async function graphqlRequestResult<TData>(
  cwd: string,
  repo: GitHubRepoRef,
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
  signal?: AbortSignal,
): Promise<GraphqlRequestResult<TData>> {
  const token = await getAuthToken(cwd, repo.host, signal)
  if (!token) {
    return {
      ok: false,
      error: graphqlError(repo, operationName, 'NO_AUTH_TOKEN', `No GitHub token available for ${repo.host}`),
    }
  }

  return enqueueGitHubApiRequest(
    async (): Promise<GraphqlRequestResult<TData>> => {
      if (signal?.aborted) {
        return {
          ok: false,
          error: graphqlError(repo, operationName, 'TIMEOUT', 'The operation was aborted.', { retryable: true }),
        }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS)
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await fetch(githubGraphqlEndpoint(repo.host), {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'Goblin',
          },
          body: JSON.stringify({ query, variables: compactVariables(variables), operationName }),
        })
        if (!response.ok) {
          const { code, retryable } = httpErrorCode(response)
          return {
            ok: false,
            error: graphqlError(repo, operationName, code, response.statusText || `HTTP ${response.status}`, {
              retryable,
              status: response.status,
            }),
          }
        }

        let payload: GraphqlEnvelope<TData>
        try {
          payload = (await response.json()) as GraphqlEnvelope<TData>
        } catch (err) {
          return {
            ok: false,
            error: graphqlError(repo, operationName, 'INVALID_JSON', err instanceof Error ? err.message : String(err), {
              retryable: true,
            }),
          }
        }

        if (payload.errors?.length) {
          const message = graphqlErrorMessage(payload.errors)
          return {
            ok: false,
            error: graphqlError(repo, operationName, 'GRAPHQL_ERROR', message, {
              retryable: /rate limit|timeout|temporar|try again/i.test(message),
              graphqlErrors: payload.errors,
            }),
          }
        }

        if (payload.data === undefined || payload.data === null) {
          return {
            ok: false,
            error: graphqlError(repo, operationName, 'NO_DATA', 'GitHub GraphQL returned no data'),
          }
        }

        return { ok: true, data: payload.data }
      } catch (err) {
        return {
          ok: false,
          error: graphqlError(
            repo,
            operationName,
            isAbortError(err) ? 'TIMEOUT' : 'NETWORK_ERROR',
            err instanceof Error ? err.message : String(err),
            { retryable: true },
          ),
        }
      } finally {
        signal?.removeEventListener('abort', abort)
        clearTimeout(timer)
      }
    },
    { signal },
  ).catch((err): GraphqlRequestResult<TData> => {
    if (signal?.aborted || isAbortError(err)) {
      return {
        ok: false,
        error: graphqlError(
          repo,
          operationName,
          'TIMEOUT',
          err instanceof Error ? err.message : 'The operation was aborted.',
          {
            retryable: true,
          },
        ),
      }
    }
    return {
      ok: false,
      error: graphqlError(repo, operationName, 'NETWORK_ERROR', err instanceof Error ? err.message : String(err), {
        retryable: true,
      }),
    }
  })
}

export async function graphqlRequest<TData>(
  cwd: string,
  repo: GitHubRepoRef,
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
  signal?: AbortSignal,
): Promise<TData | null> {
  const result = await graphqlRequestResult<TData>(cwd, repo, query, variables, operationName, signal)
  return result.ok ? result.data : null
}
