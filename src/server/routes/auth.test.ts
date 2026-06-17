import { describe, expect, test, vi } from 'vitest'
import { createAuthRoutes } from '#/server/routes/auth.ts'
import { ACCESS_TOKEN_COOKIE } from '#/shared/access-token.ts'

/**
 * The auth routes are the only way to obtain (login) or clear
 * (logout) the session cookie, and the only way for the renderer
 * to probe auth state (whoami) and read its own token
 * (access-token). The middleware that gates /api/whoami and
 * /api/access-token is the same one used for every other authed
 * route in the server, so the channel-precedence test below is
 * the regression check that the `?t=` WS query, the
 * `x-goblin-access-token` header, and the `goblin_access_token`
 * cookie all keep working as the auth surface evolves.
 */

const ACCESS_TOKEN = 'abcdefghijklmnopqrstuvwx'

function buildApp() {
  return createAuthRoutes({ accessToken: ACCESS_TOKEN })
}

function readSetCookie(res: Response): string | null {
  // Hono's Response.headers is a plain Headers object. The
  // `getSetCookie` API is the standard way to read the full
  // Set-Cookie list (potentially multiple cookies), but jsdom
  // versions used by vitest can be older; fall back to `get` if
  // necessary.
  const headers = res.headers as unknown as {
    getSetCookie?: () => string[]
    get: (name: string) => string | null
  }
  if (typeof headers.getSetCookie === 'function') {
    const all = headers.getSetCookie()
    return all.length > 0 ? all[0] : null
  }
  return headers.get('set-cookie')
}

describe('POST /api/login', () => {
  test('sets the cookie on a valid token', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: ACCESS_TOKEN }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true }
    expect(body).toEqual({ ok: true })
    const setCookie = readSetCookie(res)
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain(`${ACCESS_TOKEN_COOKIE}=${ACCESS_TOKEN}`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
    // Max-Age=1y encoded as seconds.
    expect(setCookie).toMatch(/Max-Age=31536000/i)
  })

  test('rejects a wrong token with 401 + constant-time floor', async () => {
    const app = buildApp()
    const start = Date.now()
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'x'.repeat(25) }),
      }),
    )
    const elapsed = Date.now() - start
    expect(res.status).toBe(401)
    const body = (await res.json()) as { ok: false; code: string; message: string }
    expect(body.code).toBe('FORBIDDEN')
    // The 50ms floor removes the timing signal between "wrong token"
    // and "server is unreachable at all". A test using fake timers
    // would be more deterministic; the wall-clock check below is a
    // coarse smoke test that catches a regression where the delay
    // is dropped entirely (elapsed would drop near 0).
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })

  test('rejects malformed JSON with 400 (and the same time floor)', async () => {
    const app = buildApp()
    const start = Date.now()
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    )
    const elapsed = Date.now() - start
    expect(res.status).toBe(400)
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })

  test('rejects a missing token field with 400 (and the same time floor)', async () => {
    const app = buildApp()
    const start = Date.now()
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    const elapsed = Date.now() - start
    expect(res.status).toBe(400)
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })

  test('rejects a non-string token field with 400 (and the same time floor)', async () => {
    const app = buildApp()
    const start = Date.now()
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 12345 }),
      }),
    )
    const elapsed = Date.now() - start
    expect(res.status).toBe(400)
    expect(elapsed).toBeGreaterThanOrEqual(30)
  })

  test('returns 500 when the server has no access token configured', async () => {
    const app = createAuthRoutes({ accessToken: '' })
    const res = await app.request(
      new Request('http://localhost/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'x'.repeat(25) }),
      }),
    )
    expect(res.status).toBe(500)
  })
})

describe('POST /api/logout', () => {
  test('returns ok and clears the cookie', async () => {
    const app = buildApp()
    const res = await app.request(new Request('http://localhost/logout', { method: 'POST' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: true }
    expect(body).toEqual({ ok: true })
    const setCookie = readSetCookie(res)
    expect(setCookie).not.toBeNull()
    // Honos' deleteCookie emits a `Max-Age=0` Set-Cookie.
    expect(setCookie).toMatch(/Max-Age=0/i)
  })

  test('is unauthenticated — works without a cookie', async () => {
    const app = buildApp()
    const res = await app.request(new Request('http://localhost/logout', { method: 'POST' }))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/whoami', () => {
  test('returns 200 when the cookie matches', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/whoami', {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS_TOKEN}` },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('returns 200 when the header matches', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/whoami', {
        headers: { 'x-goblin-access-token': ACCESS_TOKEN },
      }),
    )
    expect(res.status).toBe(200)
  })

  test('returns 200 when the ?t= query matches', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request(`http://localhost/whoami?t=${ACCESS_TOKEN}`),
    )
    expect(res.status).toBe(200)
  })

  test('returns 401 when nothing is supplied', async () => {
    const app = buildApp()
    const res = await app.request(new Request('http://localhost/whoami'))
    expect(res.status).toBe(401)
  })

  test('returns 401 when the cookie is wrong', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/whoami', {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=wrong` },
      }),
    )
    expect(res.status).toBe(401)
  })

  test('prefers cookie over header (cookie value wins on conflict)', async () => {
    const app = buildApp()
    // Send both a wrong header and a correct cookie — the cookie
    // should match and the request should pass. The middleware
    // checks cookie first, header second, query third.
    const res = await app.request(
      new Request('http://localhost/whoami', {
        headers: {
          'x-goblin-access-token': 'wrong',
          cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS_TOKEN}`,
        },
      }),
    )
    expect(res.status).toBe(200)
  })

  test('falls back to header when cookie is absent', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/whoami', {
        headers: { 'x-goblin-access-token': ACCESS_TOKEN },
      }),
    )
    expect(res.status).toBe(200)
  })
})

describe('GET /api/access-token', () => {
  test('echoes the token to an authenticated caller', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/access-token', {
        headers: { 'x-goblin-access-token': ACCESS_TOKEN },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { accessToken: string }
    expect(body.accessToken).toBe(ACCESS_TOKEN)
  })

  test('returns 401 to an unauthenticated caller', async () => {
    const app = buildApp()
    const res = await app.request(new Request('http://localhost/access-token'))
    expect(res.status).toBe(401)
  })

  test('returns 401 when the cookie is wrong', async () => {
    const app = buildApp()
    const res = await app.request(
      new Request('http://localhost/access-token', {
        headers: { cookie: `${ACCESS_TOKEN_COOKIE}=wrong` },
      }),
    )
    expect(res.status).toBe(401)
  })
})
