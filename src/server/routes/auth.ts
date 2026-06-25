import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { createAccessTokenMiddleware } from '#/server/common/auth.ts'
import { ACCESS_TOKEN_COOKIE } from '#/shared/access-token.ts'
import { errorJson } from '#/server/common/responses.ts'
import { safeEqualString } from '#/server/common/timing-safe.ts'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
// Constant-time padding on a miss. The token is 128-bit so brute-force
// is academic, but the 50ms floor removes a signal that distinguishes
// "wrong token" from "server is slow to respond at all".
const LOGIN_MISS_DELAY_MS = 50

export interface AuthRouteOptions {
  accessToken: string
}

/**
 * Mounts the user-facing auth surface:
 *
 * - `POST /api/login`  [unauth] — submit `{ token }`, get a cookie.
 * - `POST /api/logout` [unauth] — clear the cookie.
 * - `GET  /api/whoami` [auth]   — `{ ok: true }`, used by the
 *   client's gate UI to decide whether to show the login form.
 *
 * The login endpoint is intentionally unauthenticated: the only way
 * to *get* a cookie is to prove you already know the token. The
 * middleware is applied per-route so the other two stay open.
 */
export function createAuthRoutes({ accessToken }: AuthRouteOptions): Hono {
  const app = new Hono()

  app.post('/login', async (c) => {
    if (!accessToken) {
      return errorJson(c, 'INTERNAL', 'Server access token not configured', 500)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      // Constant-time floor so a malformed body doesn't shortcut the
      // comparison timing.
      await delay(LOGIN_MISS_DELAY_MS)
      return errorJson(c, 'BAD_REQUEST', 'Invalid JSON body')
    }
    const submitted = extractToken(body)
    if (submitted === null) {
      await delay(LOGIN_MISS_DELAY_MS)
      return errorJson(c, 'BAD_REQUEST', 'Missing token')
    }
    if (!safeEqualString(submitted, accessToken)) {
      await delay(LOGIN_MISS_DELAY_MS)
      return errorJson(c, 'FORBIDDEN', 'Invalid token', 401)
    }
    setCookie(c, ACCESS_TOKEN_COOKIE, accessToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: ONE_YEAR_SECONDS,
    })
    return c.json({ ok: true })
  })

  app.post('/logout', (c) => {
    deleteCookie(c, ACCESS_TOKEN_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/whoami', createAccessTokenMiddleware(accessToken), (c) => c.json({ ok: true }))

  // Echo the access token back to an authenticated caller. Used by
  // the Web settings page so a browser-mode operator can copy the
  // token without reading the server log. Always auth-gated; the
  // token is the only thing that authenticates, so the only callers
  // are callers who already have it.
  app.get('/access-token', createAccessTokenMiddleware(accessToken), (c) =>
    c.json({ accessToken }),
  )

  return app
}

function extractToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const candidate = (body as { token?: unknown }).token
  return typeof candidate === 'string' ? candidate : null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
