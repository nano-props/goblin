import type { MiddlewareHandler } from 'hono'

/**
 * Headers applied to every `/api/*` response. Keep the list small
 * and only add entries that have a concrete, currently-relevant
 * purpose — no "just in case" policy.
 *
 * - `Cache-Control: no-store` — settings / repo snapshots are
 *   server-authoritative and must not be cached by an intermediate
 *   proxy or service worker.
 * - `X-Content-Type-Options: nosniff` — blocks browsers / fetch
 *   clients from guessing a response type that wasn't advertised.
 * - `Vary: Origin` — needed so CORS-aware caches don't serve a
 *   preflighted response to a different origin.
 */
const API_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Origin',
}

export function applyApiSecurityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    for (const [key, value] of Object.entries(API_RESPONSE_HEADERS)) {
      // Only set when the handler hasn't picked its own value — a
      // future route that needs `Cache-Control: public, ...` should
      // be free to opt out.
      if (!c.res.headers.has(key)) c.header(key, value)
    }
  }
}

/**
 * Build a CORS origin predicate from the server's actual bind
 * address. The server supports two deployment shapes:
 *
 * 1. Loopback-only (default `127.0.0.1`) — only same-machine
 *    browsers should be able to call the API.
 * 2. LAN / public (`0.0.0.0` or a specific interface address) —
 *    the operator has explicitly asked for cross-network access,
 *    so we should not gatekeep by hostname.
 *
 * The port is the strongest signal we have that "this is the same
 * app"; the host is then either loopback, the bind host, or
 * anything (when bound to the wildcard).
 */
export function buildCorsOriginPredicate(
  serverHost: string,
  serverPort: number,
): (origin: string | undefined) => boolean {
  const portStr = String(serverPort)
  const wildcardBind = serverHost === '0.0.0.0' || serverHost === '::'
  return (origin) => {
    // Electron IPC and same-origin fetches don't set an Origin header.
    if (!origin) return true
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return false
    }
    if (parsed.port !== portStr) return false
    if (wildcardBind) return true
    // URL#hostname keeps the brackets on IPv6 literals ([::1]); strip
    // them so the loopback and bind-host comparisons stay symmetric.
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    return host === serverHost
  }
}
