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

describe('plantEmbedAuthCookie', () => {
  test('plants the cookie with the access token and same host scope', async () => {
    const { plantEmbedAuthCookie } = await import('#/main/cookie-bootstrap.ts')
    await plantEmbedAuthCookie({
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
    const { plantEmbedAuthCookie } = await import('#/main/cookie-bootstrap.ts')
    await plantEmbedAuthCookie({
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
    const { plantEmbedAuthCookie } = await import('#/main/cookie-bootstrap.ts')
    await plantEmbedAuthCookie({
      accessToken: 'dev-token-xyz',
      url: 'http://127.0.0.1:5173/?theme=light',
      webContents: webContentsMock,
    })

    const cookieArg = cookieSetMock.mock.calls[0][0]
    // Strip the query while keeping the concrete URL.
    expect(cookieArg.url).toBe('http://127.0.0.1:5173/')
  })

  test('propagates a cookies.set failure to the bootstrap owner', async () => {
    cookieSetMock.mockRejectedValueOnce(new Error('cookies.set failed'))
    const { plantEmbedAuthCookie } = await import('#/main/cookie-bootstrap.ts')
    await expect(
      plantEmbedAuthCookie({
        accessToken: 'new-token-123',
        url: 'http://127.0.0.1:32100/',
        webContents: webContentsMock,
      }),
    ).rejects.toThrow('cookies.set failed')
  })
})
