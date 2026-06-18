// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const cookieSetMock = vi.fn()
const sessionMock = { cookies: { set: cookieSetMock } }
// `Pick<WebContents, 'session'>` — only the `session` surface is
// touched by `plantEmbedAuthCookie`. Cast through `unknown` so we
// can pass a minimal stub without dragging in the full Electron
// `WebContents` type (which has dozens of unrelated properties).
const webContentsMock = { session: sessionMock } as unknown as Pick<Electron.WebContents, 'session'>

beforeEach(() => {
  cookieSetMock.mockReset()
  cookieSetMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('replantEmbedAuthCookieForRotation', () => {
  test('plants the cookie with the new access token and same host scope', async () => {
    // Regression: before this helper existed, a token rotation
    // left the renderer's `webContents.session.cookies` holding
    // the OLD token. The next authenticated request fired with
    // a stale cookie and the server rejected it, re-prompting
    // the gate. The rotation flow now calls this helper so the
    // cookie is fresh by the time the IPC returns.
    const { replantEmbedAuthCookieForRotation } = await import('#/main/cookie-bootstrap.ts')
    await replantEmbedAuthCookieForRotation({
      accessToken: 'new-token-123',
      url: 'http://127.0.0.1:32100/',
      webContents: webContentsMock,
    })

    expect(cookieSetMock).toHaveBeenCalledTimes(1)
    const cookieArg = cookieSetMock.mock.calls[0][0]
    // The cookie's URL must include the port. Chromium scopes
    // cookies to host *and* port — a port-stripped URL like
    // `http://127.0.0.1` would default the port to 80, and the
    // browser would refuse to send the cookie on requests to
    // `http://127.0.0.1:32100/`. In dev the renderer loads from
    // the Vite port (5173), in prod from the embedded server
    // port (32100); both need an explicit port in the cookie URL.
    expect(cookieArg).toMatchObject({
      url: 'http://127.0.0.1:32100/',
      name: 'goblin_access_token',
      value: 'new-token-123',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
    expect(cookieArg.expirationDate).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  test('marks the cookie as secure when the renderer URL is https', async () => {
    // The production preload's entry URL is `https://...` when
    // the renderer is served over TLS (e.g. on a LAN HTTPS
    // bind). The cookie must carry `secure: true` so the
    // browser refuses to send it on a downgrade.
    const { replantEmbedAuthCookieForRotation } = await import('#/main/cookie-bootstrap.ts')
    await replantEmbedAuthCookieForRotation({
      accessToken: 'new-token-https',
      url: 'https://goblin.lan:32100/',
      webContents: webContentsMock,
    })

    const cookieArg = cookieSetMock.mock.calls[0][0]
    expect(cookieArg.secure).toBe(true)
    expect(cookieArg.url).toBe('https://goblin.lan:32100/')
  })

  test('plants the cookie with the Vite dev URL so dev-mode whoami probes authenticate', async () => {
    // Regression: the cookie bootstrap used to strip the port
    // (`new URL(url).hostname`), which silently defaulted the
    // cookie's port to 80. In dev, the renderer loads from
    // `http://127.0.0.1:5173/` (Vite), which proxies `/api/*` to
    // the embedded server. The browser must see a cookie scoped
    // to the Vite origin, otherwise the very first whoami probe
    // fails and the token gate appears even on a fresh dev run.
    const { replantEmbedAuthCookieForRotation } = await import('#/main/cookie-bootstrap.ts')
    await replantEmbedAuthCookieForRotation({
      accessToken: 'dev-token-xyz',
      url: 'http://127.0.0.1:5173/?theme=light',
      webContents: webContentsMock,
    })

    const cookieArg = cookieSetMock.mock.calls[0][0]
    // Query string stripped — Chromium's cookies.set ignores
    // query params for scoping but they are not part of the
    // cookie URL. We only need the origin (protocol + host + port).
    expect(cookieArg.url).toBe('http://127.0.0.1:5173/')
  })

  test('propagates a cookies.set failure so the rotation handler logs it', async () => {
    // The wrapper intentionally does NOT swallow rejections —
    // the rotation handler in `access-token-bridge.ts` is the
    // seam that decides "best-effort, log and continue" vs
    // "fatal, propagate to the IPC caller". Tests for that
    // decision live in the bridge suite.
    cookieSetMock.mockRejectedValueOnce(new Error('cookies.set failed'))
    const { replantEmbedAuthCookieForRotation } = await import('#/main/cookie-bootstrap.ts')
    await expect(
      replantEmbedAuthCookieForRotation({
        accessToken: 'new-token-123',
        url: 'http://127.0.0.1:32100/',
        webContents: webContentsMock,
      }),
    ).rejects.toThrow('cookies.set failed')
  })
})
