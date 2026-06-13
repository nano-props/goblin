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
 * address. The desktop app's only realistic cross-origin scenario
 * is a browser tab pointing at the same machine, so the policy is
 * "same port, loopback or matching bind host" — anything else is
 * rejected.
 */
export function buildCorsOriginPredicate(
  serverHost: string,
  serverPort: number,
): (origin: string | undefined) => boolean {
  const portStr = String(serverPort)
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
    // URL#hostname keeps the brackets on IPv6 literals ([::1]); strip
    // them so the loopback and bind-host comparisons stay symmetric.
    const host = parsed.hostname.replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    // When the server is bound to a specific LAN address, allow the
    // same address. When bound to 0.0.0.0, the loopback check above
    // is the only allow path — non-loopback LAN clients have to hit
    // the server via its real LAN IP, which we can't enumerate.
    return host === serverHost
  }
}
