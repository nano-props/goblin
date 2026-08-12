import { onScopeDispose, reactive } from 'vue'
import { ACCESS_TOKEN_URL_PARAM } from '#/shared/access-token.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import { OkResponseSchema } from '#/shared/settings-response-schema.ts'
import { createTimeoutAbortController } from '#/web/lib/abort.ts'
import { fetchServerJson, postServerCommandJson } from '#/web/lib/server-fetch.ts'

const AUTH_STATUS_TIMEOUT_MS = 15_000

export type AccessTokenStatus = 'checking' | 'authenticated' | 'unauthenticated'

export interface AccessTokenStatusState {
  state: AccessTokenStatus
  refresh: () => void
}

function readAccessTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const token = params.get(ACCESS_TOKEN_URL_PARAM)?.trim()
    return token && token.length > 0 ? token : null
  } catch {
    return null
  }
}

function stripAccessTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(ACCESS_TOKEN_URL_PARAM)) return
    url.searchParams.delete(ACCESS_TOKEN_URL_PARAM)
    const next = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + url.hash
    window.history.replaceState(window.history.state, '', next)
  } catch {}
}

export function useAccessTokenStatus(): AccessTokenStatusState {
  let generation = 0
  let activeTimeout: ReturnType<typeof createTimeoutAbortController> | null = null
  const status = reactive<AccessTokenStatusState>({
    state: 'checking',
    refresh: () => {
      status.state = 'checking'
      void check()
    },
  })

  const check = async () => {
    generation += 1
    const currentGeneration = generation
    activeTimeout?.abort(new Error('auth status check superseded'))
    activeTimeout?.dispose()
    const timeout = createTimeoutAbortController(
      AUTH_STATUS_TIMEOUT_MS,
      `auth status check timed out after ${AUTH_STATUS_TIMEOUT_MS}ms`,
    )
    activeTimeout = timeout
    try {
      const urlLoginStatus = await exchangeUrlTokenForCookie(timeout.signal)
      if (currentGeneration !== generation) return
      if (urlLoginStatus === 'failed') {
        status.state = 'unauthenticated'
        return
      }
      try {
        const result = await fetchServerJson('/api/whoami', decodeWith(OkResponseSchema), { signal: timeout.signal })
        if (currentGeneration === generation) status.state = result.ok ? 'authenticated' : 'unauthenticated'
      } catch {
        if (currentGeneration === generation) status.state = 'unauthenticated'
      }
    } finally {
      timeout.dispose()
      if (activeTimeout === timeout) activeTimeout = null
    }
  }

  onScopeDispose(() => {
    generation += 1
    activeTimeout?.abort(new Error('auth status check cancelled'))
    activeTimeout?.dispose()
    activeTimeout = null
  })

  void check()
  return status
}

async function exchangeUrlTokenForCookie(signal: AbortSignal): Promise<'absent' | 'authenticated' | 'failed'> {
  const urlToken = readAccessTokenFromUrl()
  if (!urlToken) return 'absent'
  stripAccessTokenFromUrl()
  try {
    await postServerCommandJson('/api/login', { token: urlToken }, decodeWith(OkResponseSchema), { signal })
    return 'authenticated'
  } catch {
    return 'failed'
  }
}
