// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EmbedAuthCookieWebContents } from '#/main/cookie-bootstrap.ts'

const cookieSetMock = vi.fn()
const sessionMock = { cookies: { set: cookieSetMock } }
// Only the `session.cookies.set` surface is touched by
// `plantEmbedAuthCookie`; keep the mock structural so this node test
// never resolves Electron's runtime package.
const webContentsMock = { session: sessionMock } as EmbedAuthCookieWebContents

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
    // left the client's `webContents.session.cookies` holding
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
    // The API gets the concrete URL; the cookie remains host-scoped with `Path=/`.
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

  test('marks the cookie as secure when the client URL is https', async () => {
    // The production preload's entry URL is `https://...` when
    // the client is served over TLS (e.g. on a LAN HTTPS
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
    // Keep the concrete Vite URL; the cookie remains host-scoped with `Path=/`.
    const { replantEmbedAuthCookieForRotation } = await import('#/main/cookie-bootstrap.ts')
    await replantEmbedAuthCookieForRotation({
      accessToken: 'dev-token-xyz',
      url: 'http://127.0.0.1:5173/?theme=light',
      webContents: webContentsMock,
    })

    const cookieArg = cookieSetMock.mock.calls[0][0]
    // Strip the query while keeping the concrete URL.
    expect(cookieArg.url).toBe('http://127.0.0.1:5173/')
  })

  test('propagates a cookies.set failure so the rotation handler logs it', async () => {
    // The wrapper intentionally does NOT swallow rejections —
    // the rotation handler in `access-token-ipc.ts` is the
    // seam that decides "best-effort, log and continue" vs
    // "fatal, propagate to the IPC caller". Tests for that
    // decision live in the IPC handler suite.
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
