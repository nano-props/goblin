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
    expect(cookieArg).toMatchObject({
      url: 'http://127.0.0.1',
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
    expect(cookieArg.url).toBe('https://goblin.lan')
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
