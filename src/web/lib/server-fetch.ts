import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'

interface EmbeddedServerConfig {
  url: string
  secret: string
}

function getEmbeddedServer(): EmbeddedServerConfig | null {
  const server = getInitialBootstrap().initialServer
  if (!server?.url || !server?.secret) return null
  return server
}

function requireEmbeddedServer(): EmbeddedServerConfig {
  const server = getEmbeddedServer()
  if (!server) throw new Error('Embedded server unavailable')
  return server
}

export async function fetchServerJson<T>(path: string | URL, init?: RequestInit): Promise<T> {
  const server = requireEmbeddedServer()
  const url = typeof path === 'string' ? new URL(path, resolveApiBaseUrl(server.url)).toString() : path.toString()
  const { headers: extraHeaders, ...rest } = init ?? {}
  const headers: Record<string, string> = {
    'x-goblin-internal-secret': server.secret,
  }
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => {
      headers[key] = value
    })
  }
  const response = await fetch(url, { ...rest, headers })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { message?: string; code?: string } | undefined
      if (body?.message) detail = `${body.code ?? response.status}: ${body.message}`
    } catch {}
    throw new Error(`Server request failed (${detail})`)
  }
  return (await response.json()) as T
}

export async function postServerJson<TInput extends object, TOutput>(
  path: string,
  input: TInput,
  options?: { signal?: AbortSignal },
): Promise<TOutput> {
  return await fetchServerJson<TOutput>(path, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}

type QueryParamValue = string | number | boolean | undefined | null | Array<string | number>

function appendQueryParam(url: URL, key: string, value: string | number | boolean): void {
  url.searchParams.append(key, String(value))
}

export async function getServerJson<TParams extends Record<string, QueryParamValue>, TOutput>(
  path: string,
  params: TParams,
  options?: { signal?: AbortSignal },
): Promise<TOutput> {
  const url = new URL(path, resolveApiBaseUrl(requireEmbeddedServer().url))
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) appendQueryParam(url, key, item)
    } else {
      appendQueryParam(url, key, value)
    }
  }
  return await fetchServerJson<TOutput>(url, {
    method: 'GET',
    signal: options?.signal,
  })
}
