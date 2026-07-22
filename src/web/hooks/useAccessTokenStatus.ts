import { useCallback, useEffect, useState } from 'react'
import { fetchServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import { OkResponseSchema } from '#/shared/settings-response-schema.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { ACCESS_TOKEN_URL_PARAM } from '#/shared/access-token.ts'
import { createTimeoutAbortController } from '#/web/lib/abort.ts'

const AUTH_STATUS_TIMEOUT_MS = 15_000

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
 * the hook strips the param from the URL before the network hop, then
 * POSTs it to `/api/login` to set the cookie. The subsequent `whoami`
 * then succeeds and the gate clears without a page reload.
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
    const timeout = createTimeoutAbortController(
      AUTH_STATUS_TIMEOUT_MS,
      `auth status check timed out after ${AUTH_STATUS_TIMEOUT_MS}ms`,
    )
    void (async () => {
      try {
        const urlLoginStatus = await exchangeUrlTokenForCookie(timeout.signal)
        if (cancelled) return
        if (urlLoginStatus === 'failed') {
          setState('unauthenticated')
          return
        }
        // Step 2: probe the auth state.
        try {
          const result = await fetchServerJson('/api/whoami', decodeWith(OkResponseSchema), { signal: timeout.signal })
          if (cancelled) return
          setState(result.ok ? 'authenticated' : 'unauthenticated')
        } catch {
          if (cancelled) return
          setState('unauthenticated')
        }
      } finally {
        timeout.dispose()
      }
    })()
    return () => {
      cancelled = true
      timeout.abort(new Error('auth status check cancelled'))
      timeout.dispose()
    }
  }, [refreshKey])

  return { state, refresh }
}

async function exchangeUrlTokenForCookie(signal: AbortSignal): Promise<'absent' | 'authenticated' | 'failed'> {
  // If the URL carries an access token, exchange it for a cookie. Strip it
  // before the network hop so unmounts, redirects, or stalled requests cannot
  // leave the token in browser history or future Referer headers.
  const urlToken = readAccessTokenFromUrl()
  if (!urlToken) return 'absent'
  stripAccessTokenFromUrl()
  try {
    await postServerJson('/api/login', { token: urlToken }, decodeWith(OkResponseSchema), { signal })
    return 'authenticated'
  } catch {
    // Bad token (401) or network error. Either way, the token is already gone
    // from the URL and the login form re-appears so the user can paste a
    // corrected token by hand.
    return 'failed'
  }
}
