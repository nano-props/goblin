// Auth cookie bootstrap for the embedded Electron renderer.
//
// Why this exists: the renderer in any deployment (Electron, web,
// Vite-served dev) authenticates against the server with an
// http-only cookie set by `POST /api/login`. The web path is
// trivial — the user pastes the token into the gate, the cookie
// sticks, done. The Electron path can't ask the user to paste a
// token on first run, so the main process has to do the
// equivalent: log in once with the access token it spawned the
// server with, then plant the resulting cookie on the renderer's
// session so the very first request the renderer fires already
// authenticates.
//
// Before this module, the preload fetched the access token + URL
// over IPC and stuffed them into `window.__GOBLIN_BOOTSTRAP__` so
// the renderer's HTTP client could send the token as a header.
// That worked but had two architectural costs:
//
//  1. **Two auth channels.** Header auth in the embedded case,
//     cookie auth in the web case, with two render-side code
//     paths and two server-side checks that have to agree about
//     what "authenticated" means.
//
//  2. **A race at first paint.** The preload's IPC was async
//     (Promise.all of four `ipcRenderer.invoke` calls), but the
//     renderer's auth probe and terminal bridge read
//     `__GOBLIN_BOOTSTRAP__` synchronously on first render. The
//     only fix was `sendSync`, which blocks the renderer's JS
//     thread for ~1-4ms per call — small, but it's still a
//     synchronous IPC for a value (the access token) we don't
//     actually need in the renderer.
//
// Setting the cookie on the session collapses both costs. The
// renderer is identical to the web build: it calls
// `fetchServerJson('/api/whoami')`, the browser attaches the
// cookie, the server returns 200, the gate clears. No bootstrap
// plumbing, no IPC for the access token, no sync-vs-async dance.

import { type WebContents } from 'electron'
import { ACCESS_TOKEN_COOKIE } from '#/shared/access-token.ts'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export interface EmbedAuthCookieOptions {
  /**
   * The access token the main process used to spawn the embedded
   * server. Will be wrapped as an http-only session cookie so the
   * renderer's first request authenticates without a token gate.
   */
  accessToken: string
  /**
   * The URL the renderer is about to load. The cookie's scope is
   * the host of this URL (cookies don't carry port). Pass the
   * Vite URL in dev (`http://127.0.0.1:5173/`) and the embedded
   * server URL in production — the cookie is set on the host the
   * page actually loads from, not on the server's bind address.
   */
  url: string
  webContents: WebContents
}

/**
 * Plant the auth cookie on the renderer's session. Idempotent —
 * overwrites an existing cookie if one is already there (e.g. the
 * user rotated their token, or a previous run left a stale value).
 * Awaits the underlying `cookies.set` so the caller can be sure
 * the cookie is in place before the renderer fires its first
 * request; the renderer is normally paused on `did-finish-load`
 * by the time the caller is ready, but in dev mode the proxy
 * round-trip is fast enough that this matters in practice.
 */
export async function plantEmbedAuthCookie({
  accessToken,
  url,
  webContents,
}: EmbedAuthCookieOptions): Promise<void> {
  const parsed = new URL(url)
  await webContents.session.cookies.set({
    url: `${parsed.protocol}//${parsed.hostname}`,
    name: ACCESS_TOKEN_COOKIE,
    value: accessToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: parsed.protocol === 'https:',
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + ONE_YEAR_SECONDS,
  })
}

export interface ReplantEmbedAuthCookieForRotationOptions {
  accessToken: string
  url: string
  webContents: Pick<WebContents, 'session'>
}

/**
 * Replant the auth cookie after the embedded server restarts with a
 * new access token. Thin wrapper over `plantEmbedAuthCookie` that
 * uses a narrower `webContents` type so the rotation flow in
 * `access-token-bridge.ts` can inject a `Pick<WebContents, 'session'>`
 * without depending on the full Electron surface.
 *
 * Without this replant, a rotation leaves the renderer's
 * `webContents.session.cookies` holding the OLD token. The next
 * authenticated request fires with the stale cookie, the server
 * rejects it, and the user sees the token gate re-appear even
 * though the rotation IPC returned the new token successfully.
 */
export async function replantEmbedAuthCookieForRotation({
  accessToken,
  url,
  webContents,
}: ReplantEmbedAuthCookieForRotationOptions): Promise<void> {
  await plantEmbedAuthCookie({
    accessToken,
    url,
    webContents: webContents as WebContents,
  })
}
