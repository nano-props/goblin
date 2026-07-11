import { normalizeClientServerClientId, readInjectedWebBootstrap } from '#/web/client-bootstrap-bridge.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'

const WEB_TERMINAL_CLIENT_ID_STORAGE_KEY = 'goblin:terminal-client-id'
const fallbackWebTerminalClientId = createOpaqueId('client')

export function readOrCreateWebTerminalClientId(): string {
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
    const created = createOpaqueId('client')
    storage?.setItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY, created)
    return created
  } catch {
    return fallbackWebTerminalClientId
  }
}
