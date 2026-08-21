// The native host authenticates the embedded client through the same http-only
// cookie contract as browser clients. The cookie must exist before loadURL so
// the renderer never receives the access token itself.

import { ACCESS_TOKEN_COOKIE } from '#/shared/access-token.ts'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

interface AuthCookieDetails {
  url: string
  name: string
  value: string
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  path: string
  expirationDate: number
}

export interface EmbedAuthCookieWebContents {
  session: {
    cookies: {
      set(details: AuthCookieDetails): Promise<void>
    }
  }
}

export interface EmbedAuthCookieOptions {
  /**
   * The access token the native host used to spawn the embedded
   * server. Will be wrapped as an http-only session cookie so the
   * client's first request authenticates without a token gate.
   */
  accessToken: string
  /**
   * The concrete client URL. The cookie is host-scoped, not port-scoped;
   * `Path=/` sends it to every path, and the protocol controls `Secure`.
   */
  url: string
  webContents: EmbedAuthCookieWebContents
}

/**
 * Plant the auth cookie on the client's session. Idempotent —
 * overwrites an existing cookie if one is already there (e.g. the
 * previous run left a stale value).
 * Awaits the underlying `cookies.set` so the caller can be sure
 * the cookie is in place before `loadURL` starts the client and its
 * first request. In dev mode the proxy round-trip is fast enough
 * that this ordering matters in practice.
 */
export async function plantEmbedAuthCookie({ accessToken, url, webContents }: EmbedAuthCookieOptions): Promise<void> {
  // Keep the concrete URL for Electron; the cookie is host-scoped, not port-scoped.
  //
  // Query params (`?theme=light&colorTheme=macos`) are dropped
  // because they do not affect cookie matching; stripping them keeps
  // the cookies.set payload stable.
  const parsed = new URL(url)
  parsed.search = ''
  const cookieUrl = parsed.toString()
  await webContents.session.cookies.set({
    url: cookieUrl,
    name: ACCESS_TOKEN_COOKIE,
    value: accessToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: parsed.protocol === 'https:',
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS,
  })
}
