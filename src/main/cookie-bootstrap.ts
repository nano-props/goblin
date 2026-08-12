// Auth cookie bootstrap for the embedded Electron client.
//
// Why this exists: the client in any deployment (Electron, web,
// Vite-served dev) authenticates against the server with an
// http-only cookie set by `POST /api/login`. The web path is
// trivial — the user pastes the token into the gate, the cookie
// sticks, done. The Electron path can't ask the user to paste a
// token on first run, so the native host has to do the
// equivalent: log in once with the access token it spawned the
// server with, then plant the resulting cookie on the client's
// session so the very first request the client fires already
// authenticates.
//
// Before this module, the preload fetched the access token + URL
// over IPC and stuffed them into `window.__GOBLIN_BOOTSTRAP__` so
// the client's HTTP client could send the token as a header.
// That worked but had two architectural costs:
//
//  1. **Two auth channels.** Header auth in the embedded case,
//     cookie auth in the web case, with two render-side code
//     paths and two server-side checks that have to agree about
//     what "authenticated" means.
//
//  2. **A race at first paint.** The preload's IPC was async
//     (Promise.all of four `ipcRenderer.invoke` calls), but the
//     client's auth probe and terminal client read
//     `__GOBLIN_BOOTSTRAP__` synchronously on first render. The
//     only fix was `sendSync`, which blocks the client's JS
//     thread for ~1-4ms per call — small, but it's still a
//     synchronous IPC for a value (the access token) we don't
//     actually need in the client.
//
// Setting the cookie on the session collapses both costs. The
// client is identical to the web build: it calls
// `fetchServerJson('/api/whoami')`, the browser attaches the
// cookie, the server returns 200, the gate clears. No bootstrap
// plumbing, no IPC for the access token, no sync-vs-async dance.

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
