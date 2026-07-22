import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { safeEqualString } from '#/server/common/timing-safe.ts'
import { errorJson } from '#/server/common/responses.ts'
import { deriveUserId } from '#/server/common/identity.ts'
import { ACCESS_TOKEN_COOKIE, ACCESS_TOKEN_HEADER, ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'

/**
 * HTTP auth middleware for the access token. Cookie and header are the
 * only accepted channels; tokens in URLs are rejected.
 *
 * Cookie is the canonical channel for browser clients. Header is
 * the canonical channel for the embedded Electron client.
 * On success the middleware stashes an `userId` derived from the
 * token on the Hono context so downstream handlers can partition
 * in-memory state by token identity (rather than by per-page
 * `clientId`). See `identity.ts` for the full model.
 */
export function createAccessTokenMiddleware(token: string): MiddlewareHandler {
  return createAccessTokenMiddlewareForChannels(token, false)
}

/** WebSocket upgrade auth additionally accepts the browser-compatible query channel. */
export function createWebSocketAccessTokenMiddleware(token: string): MiddlewareHandler {
  return createAccessTokenMiddlewareForChannels(token, true)
}

function createAccessTokenMiddlewareForChannels(token: string, allowQuery: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (!token) {
      // Refuse to start serving with an empty token: every request
      // would be a 401, but the failure mode we'd most want to
      // notice is "server misconfigured", not "every client broken".
      return errorJson(c, 'INTERNAL', 'Server access token not configured', 500)
    }
    const cookieValue = readCookie(c, ACCESS_TOKEN_COOKIE)
    const headerValue = c.req.header(ACCESS_TOKEN_HEADER) ?? ''
    if (cookieValue && safeEqualString(cookieValue, token)) {
      c.set('userId', deriveUserId(token))
      return next()
    }
    if (headerValue && safeEqualString(headerValue, token)) {
      c.set('userId', deriveUserId(token))
      return next()
    }
    const queryValue = allowQuery ? (c.req.query(ACCESS_TOKEN_QUERY) ?? '') : ''
    if (queryValue && safeEqualString(queryValue, token)) {
      c.set('userId', deriveUserId(token))
      return next()
    }
    return errorJson(c, 'FORBIDDEN', 'Unauthorized', 401)
  }
}

/**
 * Read a single cookie from the request's Cookie header. Uses
 * Hono's `getCookie` (which percent-decodes values and handles
 * quoted / `=`-inside-value cases per RFC 6265) — the previous
 * inline parser split on the literal `=` and would have rejected
 * any token containing it. Since the access-token format is base36
 * (`[0-9a-z]`) no decoding actually fires today, but a future
 * format change (e.g. base64url) would have silently broken login
 * for the unlucky user with an `=` in their token.
 */
function readCookie(c: Context, name: string): string {
  return getCookie(c, name) ?? ''
}
