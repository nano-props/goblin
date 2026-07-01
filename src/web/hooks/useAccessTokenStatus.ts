import { useCallback, useEffect, useState } from 'react'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import { ACCESS_TOKEN_URL_PARAM } from '#/shared/access-token.ts'

export type AccessTokenStatus = 'checking' | 'authenticated' | 'unauthenticated'

export interface AccessTokenStatusState {
  state: AccessTokenStatus
  /**
   * Bump the internal counter to force a re-check of `/api/whoami`.
   * Use after a successful `POST /api/login` so the gate clears
   * without a full page reload.
   */
  refresh: () => void
}

/**
 * Extract an access token from the URL query string, if present.
 * Returns `null` when no `accessToken` query param exists.
 */
function readAccessTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const token = params.get(ACCESS_TOKEN_URL_PARAM)?.trim()
    return token && token.length > 0 ? token : null
  } catch {
    return null
  }
}

/**
 * Strip the `accessToken` query param from the URL bar (and from
 * the history entry) without reloading the page. Called after any
 * URL-token consume — successful or not — so the token doesn't
 * linger in browser history or get sent as a `Referer` header.
 */
function stripAccessTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(ACCESS_TOKEN_URL_PARAM)) return
    url.searchParams.delete(ACCESS_TOKEN_URL_PARAM)
    const next = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + url.hash
    window.history.replaceState(window.history.state, '', next)
  } catch {}
}

/**
 * Track whether the client is currently authenticated against the
 * embedded server. The check is a single `GET /api/whoami`; the
 * server returns 200 when cookie / header / `?t=` is valid and 401
 * otherwise. The client's `server-fetch` already wires up the
 * right auth channel (header for embedded, cookie for browser) so
 * the caller doesn't need to think about it.
 *
 * URL-token handling: when the page is opened with `?accessToken=...`
 * (e.g. by scanning a QR code printed by `scripts/start-server.ts`),
 * the hook POSTs it to `/api/login` to set the cookie, then strips
 * the param from the URL. The subsequent `whoami` then succeeds
 * and the gate clears without a page reload.
 */
export function useAccessTokenStatus(): AccessTokenStatusState {
  const [state, setState] = useState<AccessTokenStatus>('checking')
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => {
    setState('checking')
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Step 1: if the URL carries an access token, exchange it for
      // a cookie. Errors are swallowed — the gate will fall back to
      // the manual login form on the next whoami.
      const urlToken = readAccessTokenFromUrl()
      if (urlToken) {
        let loginOk = false
        try {
          await postServerJson<{ token: string }, { ok: true }>('/api/login', { token: urlToken })
          loginOk = true
        } catch {
          // Bad token (401) or network error. Either way, strip the
          // token from the URL: on a successful login the cookie
          // outlives the URL, and on a failure the token must not
          // linger — it would otherwise be sent as `Referer` on
          // any subsequent same-origin request and stay in browser
          // history indefinitely. The login form re-appears
          // (state = unauthenticated below) so the user can paste
          // a corrected token by hand.
        }
        if (cancelled) return
        stripAccessTokenFromUrl()
        if (!loginOk) {
          setState('unauthenticated')
          return
        }
      }
      // Step 2: probe the auth state.
      try {
        const result = await fetchServerJson<{ ok: true }>('/api/whoami')
        if (cancelled) return
        setState(result.ok ? 'authenticated' : 'unauthenticated')
      } catch {
        if (cancelled) return
        setState('unauthenticated')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return { state, refresh }
}
