import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import type { TerminalClientMessage, TerminalSocketServerMessage } from '#/shared/terminal-socket.ts'
import { normalizeTerminalSocketServerMessage } from '#/shared/terminal-validators.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'

export function createTerminalWebSocketUrl(baseUrl: string, accessToken: string, clientId: string): string {
  const httpUrl = new URL('/ws/terminal', baseUrl)
  httpUrl.protocol = resolveWebSocketProtocol()
  // `?t=` is the WebSocket auth channel for the access token. The
  // browser path also sends the cookie (auto-attached on the WS
  // upgrade), but `?t=` works for both browser and Electron — and
  // it's the only way to authenticate a non-browser WS client (LAN
  // CLI). The server middleware accepts all three channels
  // (cookie / header / `?t=`).
  httpUrl.searchParams.set(ACCESS_TOKEN_QUERY, accessToken)
  httpUrl.searchParams.set('clientId', clientId)
  return httpUrl.toString()
}

export function parseTerminalSocketServerMessage(data: unknown): TerminalSocketServerMessage | null {
  if (typeof data !== 'string') return null
  try {
    return normalizeTerminalSocketServerMessage(JSON.parse(data))
  } catch {}
  return null
}

export function encodeClientMessage(message: TerminalClientMessage): string {
  return JSON.stringify(message)
}

export function createSocketRequestId(): string {
  return createOpaqueId('req')
}
