import { resolveApiBaseUrl } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_HEADER } from '#/shared/access-token.ts'
import { requireClientServerConfig } from '#/web/lib/server-config.ts'

export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 120_000
export const SERVER_REQUEST_TIMEOUT_ERROR = 'error.request-timeout'

export interface ServerFetchOptions extends RequestInit {
  /** Request-level watchdog. Set to 0 to disable. */
  timeoutMs?: number
}

function composeRequestSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal?: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  if ((!timeoutMs || timeoutMs <= 0) && !signal) return { dispose: () => {}, timedOut: () => false }
  const controller = new AbortController()
  let timedOut = false
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (timeoutMs > 0) {
    timeout = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort(new Error(SERVER_REQUEST_TIMEOUT_ERROR))
    }, timeoutMs)
  }
  if (signal) {
    if (signal.aborted) abortFromCaller()
    else signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timeout) globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromCaller)
    },
    timedOut: () => timedOut,
  }
}

export async function fetchServerJson<T>(path: string | URL, init?: ServerFetchOptions): Promise<T> {
  const server = requireClientServerConfig()
  const url = typeof path === 'string' ? new URL(path, resolveApiBaseUrl(server.url)).toString() : path.toString()
  const { headers: extraHeaders, timeoutMs = DEFAULT_SERVER_REQUEST_TIMEOUT_MS, signal, ...rest } = init ?? {}
  const headers: Record<string, string> = {}
  if (server.accessToken) {
    // Embedded client or dev mode: send the token as a header.
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
  const requestSignal = composeRequestSignal(signal, timeoutMs)
  try {
    const response = await fetch(url, { ...rest, signal: requestSignal.signal, headers, credentials: 'include' })
    if (!response.ok) {
      let detail = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { message?: string; code?: string } | undefined
        if (body?.message) detail = `${body.code ?? response.status}: ${body.message}`
      } catch {}
      throw new Error(`Server request failed (${detail})`)
    }
    return (await response.json()) as T
  } catch (err) {
    if (requestSignal.timedOut()) throw new Error(SERVER_REQUEST_TIMEOUT_ERROR)
    throw err
  } finally {
    requestSignal.dispose()
  }
}

export async function postServerJson<TInput extends object, TOutput>(
  path: string,
  input: TInput,
  options?: { signal?: AbortSignal; keepalive?: boolean; timeoutMs?: number },
): Promise<TOutput> {
  return await fetchServerJson<TOutput>(path, {
    method: 'POST',
    signal: options?.signal,
    keepalive: options?.keepalive,
    timeoutMs: options?.timeoutMs,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })
}
