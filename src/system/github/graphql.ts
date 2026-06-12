import { execa } from 'execa'
import { getRemotes, getUpstreamParts, pickPreferredRemote } from '#/system/git/remote.ts'
import { isGitHubHost, parseGitRemoteUrl } from '#/system/git/remote-url.ts'
import {
  enqueueGitHubApiRequest,
  GITHUB_API_CONCURRENCY,
  GITHUB_API_INTERVAL_CAP,
  GITHUB_API_INTERVAL_MS,
} from '#/system/github/queue.ts'
import { buildGitHubCliPath } from '#/system/github-cli.ts'

export const GITHUB_API_TIMEOUT_MS = 17_000
export { GITHUB_API_CONCURRENCY, GITHUB_API_INTERVAL_CAP, GITHUB_API_INTERVAL_MS }

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

export function parseGitHubRemoteUrl(url: string): GitHubRepoRef | null {
  const parsed = parseGitRemoteUrl(url)
  if (!parsed || !isGitHubHost(parsed.host)) return null
  const parts = parsed.path.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return { host: parsed.host, owner: parts[0]!, name: parts[1]! }
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
      .map((remote) => ({ name: remote.name, repo: parseGitHubRemoteUrl(remote.fetchUrl) }))
      .filter((remote): remote is { name: string; repo: GitHubRepoRef } => remote.repo !== null)
    return pickGitHubRepoRef(remotes, upstream)
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return null
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && (err.name === 'AbortError' || err.message === 'The operation was aborted.')
}

function ghErrorText(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const parts = [
    typeof (err as { shortMessage?: unknown }).shortMessage === 'string'
      ? (err as { shortMessage: string }).shortMessage
      : '',
    typeof (err as { stderr?: unknown }).stderr === 'string' ? (err as { stderr: string }).stderr : '',
    typeof (err as { stdout?: unknown }).stdout === 'string' ? (err as { stdout: string }).stdout : '',
    err instanceof Error ? err.message : String(err),
  ]
  return parts
    .map((part) => part.trim())
    .filter((part, index, array) => part.length > 0 && array.indexOf(part) === index)
    .join('\n')
}

function ghErrorStatus(message: string): number | undefined {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i)
  if (!match) return undefined
  const status = Number(match[1])
  return Number.isFinite(status) ? status : undefined
}

function ghErrorDetails(message: string): { code: GraphqlErrorCode; retryable: boolean; status?: number } {
  const status = ghErrorStatus(message)
  if (/rate limit/i.test(message)) return { code: 'RATE_LIMITED', retryable: true, status }
  if (/not logged in|authentication required|authenticate with|run:\s*gh auth login|set the gh_token/i.test(message)) {
    return { code: 'NO_AUTH_TOKEN', retryable: false, status }
  }
  if (status === 401) return { code: 'UNAUTHORIZED', retryable: false, status }
  if (status === 403) return { code: 'FORBIDDEN', retryable: false, status }
  if (status !== undefined) return { code: 'HTTP_ERROR', retryable: status >= 500, status }
  return { code: 'NETWORK_ERROR', retryable: true }
}

async function ghGraphqlRequest<TData>(
  cwd: string,
  repo: GitHubRepoRef,
  query: string,
  variables: Record<string, unknown>,
  operationName: string,
  signal?: AbortSignal,
): Promise<GraphqlRequestResult<TData>> {
  try {
    const { stdout } = await execa(
      'gh',
      ['api', 'graphql', '--hostname', repo.host, '--method', 'POST', '--input', '-'],
      {
        cwd,
        input: JSON.stringify({
          query,
          variables: compactVariables(variables),
          operationName,
        }),
        timeout: GITHUB_API_TIMEOUT_MS,
        forceKillAfterDelay: 500,
        cancelSignal: signal,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          GH_PROMPT_DISABLED: '1',
          PATH: buildGitHubCliPath(),
        },
      },
    )
    let payload: GraphqlEnvelope<TData>
    try {
      payload = JSON.parse(stdout) as GraphqlEnvelope<TData>
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
    if (isAbortError(err)) {
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
    const message = ghErrorText(err)
    const { code, retryable, status } = ghErrorDetails(message)
    return {
      ok: false,
      error: graphqlError(repo, operationName, code, message, { retryable, status }),
    }
  }
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
  return enqueueGitHubApiRequest(
    async (): Promise<GraphqlRequestResult<TData>> => {
      if (signal?.aborted) {
        return {
          ok: false,
          error: graphqlError(repo, operationName, 'TIMEOUT', 'The operation was aborted.', { retryable: true }),
        }
      }
      return ghGraphqlRequest<TData>(cwd, repo, query, variables, operationName, signal)
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
