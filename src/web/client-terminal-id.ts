import { normalizeClientServerClientId, readInjectedWebBootstrap } from '#/web/client-bootstrap-bridge.ts'

const WEB_TERMINAL_CLIENT_ID_STORAGE_KEY = 'goblin:terminal-client-id'

export function readOrCreateWebTerminalClientId(): string {
  const fallback = `client_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  try {
    const bootstrapClientId = normalizeClientServerClientId(readInjectedWebBootstrap()?.initialServer?.clientId)
    if (bootstrapClientId) return bootstrapClientId
    const queryClientId = normalizeClientServerClientId(
      new URLSearchParams(window.location.search).get('goblinServerClientId')?.trim(),
    )
    if (queryClientId) return queryClientId
    const storage = window.sessionStorage
    const existing = storage?.getItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY)?.trim()
    if (existing) return existing
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `client_${crypto.randomUUID().replace(/-/g, '')}`
        : fallback
    storage?.setItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY, created)
    return created
  } catch {
    return fallback
  }
}
