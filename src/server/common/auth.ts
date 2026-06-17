import type { MiddlewareHandler } from 'hono'
import { safeEqualString } from '#/server/common/timing-safe.ts'
import { errorJson } from '#/server/common/responses.ts'
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_HEADER, ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'

/**
 * Auth middleware for the access token. Accepts the token through
 * any of three channels (cookie → header → query), checked with
 * constant-time comparison. Used on every `/api/*` route that
 * requires auth, and on `/ws/invalidation` / `/ws/terminal`.
 *
 * Cookie is the canonical channel for browser clients. Header is
 * the canonical channel for the embedded Electron renderer.
 * Query is the fallback for WebSocket clients (browsers can't set
 * WS headers; non-browser clients don't have a cookie jar).
 */
export function createAccessTokenMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!token) {
      // Refuse to start serving with an empty token: every request
      // would be a 401, but the failure mode we'd most want to
      // notice is "server misconfigured", not "every client broken".
      return errorJson(c, 'INTERNAL', 'Server access token not configured', 500)
    }
    const cookieValue = parseCookie(c.req.header('cookie') ?? '', ACCESS_TOKEN_COOKIE)
    const headerValue = c.req.header(ACCESS_TOKEN_HEADER) ?? ''
    const queryValue = c.req.query(ACCESS_TOKEN_QUERY) ?? ''
    // Order matters only for the observability of which channel
    // matched; the security guarantee comes from safeEqualString.
    if (cookieValue && safeEqualString(cookieValue, token)) return next()
    if (headerValue && safeEqualString(headerValue, token)) return next()
    if (queryValue && safeEqualString(queryValue, token)) return next()
    return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
  }
}

/**
 * Minimal cookie header parser. Handles `name=value; name2=value2`
 * with optional whitespace around `;` and `=`. Does not handle
 * quoted values or `=` inside values — the cookie set by
 * `POST /api/login` is a base36 string with no special characters,
 * so the simple split is sufficient. If a future cookie needs more
 * structure, swap in `cookie` from `npm:cookie` and keep the
 * `name` argument as the lookup key.
 */
function parseCookie(cookieHeader: string, name: string): string {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1)
  }
  return ''
}
