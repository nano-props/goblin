import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'

interface EmbeddedServerConfig {
  url: string
  accessToken: string
}

function getEmbeddedServer(): EmbeddedServerConfig | null {
  // Three paths can populate the bootstrap's `initialServer`:
  //
  //  1. **Electron embedded renderer** — the preload's IIFE in
  //     `preload.cjs` calls `goblin:get-embedded-server-url` and
  //     `goblin:get-access-token` IPC, then writes the result to
  //     `window.__GOBLIN_BOOTSTRAP__`. The token is sent as the
  //     `x-goblin-access-token` header on every fetch.
  //
  //  2. **QR-code URL bootstrap** — `?accessToken=…` on first
  //     load; `useAccessTokenStatus` POSTs it to `/api/login` to
  //     set the cookie, then strips the param from the URL. After
  //     the first paint the token is gone and the renderer
  //     authenticates via the cookie.
  //
  //  3. **Standalone browser / `serve.sh`** — no preload, no URL
  //     token. The bootstrap's `initialServer.url` is empty and
  //     the renderer falls back to `window.location.origin` here.
  //     The renderer authenticates via the http-only cookie set
  //     by `POST /api/login`.
  //
  // The `accessToken` field is only set in path (1). Paths (2) and
  // (3) leave it empty; the caller MUST NOT attach the header in
  // that case — the browser will send the cookie automatically.
  const fromBootstrap = getInitialBootstrap().initialServer
  if (fromBootstrap?.url) {
    return { url: fromBootstrap.url, accessToken: fromBootstrap.accessToken ?? '' }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return { url: window.location.origin, accessToken: '' }
  }
  return null
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
