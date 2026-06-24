import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'
import { requireRendererServerConfig } from '#/web/lib/server-config.ts'

export async function fetchServerJson<T>(path: string | URL, init?: RequestInit): Promise<T> {
  const server = requireRendererServerConfig()
  const url = typeof path === 'string' ? new URL(path, resolveApiBaseUrl(server.url)).toString() : path.toString()
  const { headers: extraHeaders, ...rest } = init ?? {}
  const headers: Record<string, string> = {}
  if (server.accessToken) {
    // Embedded renderer or dev mode: send the token as a header.
    // Standalone browser mode: leave the header off entirely; the
    // cookie is the only auth channel and the browser attaches it
    // automatically on same-origin requests.
    headers[ACCESS_TOKEN_HEADER] = server.accessToken
  }
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => {
      headers[key] = value
    })
  }
  // `credentials: 'include'` makes the browser attach the cookie on
  // cross-origin LAN requests; for same-origin (the Vite dev proxy
  // case) it's a no-op.
  const response = await fetch(url, { ...rest, headers, credentials: 'include' })
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

type QueryParamValue = string | number | boolean | undefined | null

function appendQueryParam(url: URL, key: string, value: string | number | boolean): void {
  url.searchParams.append(key, String(value))
}

export async function getServerJson<TParams extends Record<string, QueryParamValue>, TOutput>(
  path: string,
  params: TParams,
  options?: { signal?: AbortSignal },
): Promise<TOutput> {
  const url = new URL(path, resolveApiBaseUrl(requireRendererServerConfig().url))
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    appendQueryParam(url, key, value)
  }
  return await fetchServerJson<TOutput>(url, {
    method: 'GET',
    signal: options?.signal,
  })
}
