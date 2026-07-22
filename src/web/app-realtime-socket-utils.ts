import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import type { AppRealtimeClientMessage, AppRealtimeSocketServerMessage } from '#/shared/app-realtime-socket.ts'
import { normalizeAppRealtimeSocketServerMessage } from '#/shared/app-realtime-validators.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'

export function createAppRealtimeWebSocketUrl(baseUrl: string, accessToken: string, clientId: string): string {
  const httpUrl = new URL('/ws/app', baseUrl)
  httpUrl.protocol = resolveWebSocketProtocol(baseUrl)
  // `?t=` is the WebSocket auth channel for non-browser clients. Browser
  // clients also send the auth cookie during the upgrade.
  httpUrl.searchParams.set(ACCESS_TOKEN_QUERY, accessToken)
  httpUrl.searchParams.set('clientId', clientId)
  return httpUrl.toString()
}

export function parseAppRealtimeSocketServerMessage(data: unknown): AppRealtimeSocketServerMessage | null {
  if (typeof data !== 'string') return null
  try {
    return normalizeAppRealtimeSocketServerMessage(JSON.parse(data))
  } catch {}
  return null
}

export function encodeAppRealtimeClientMessage(message: AppRealtimeClientMessage): string {
  return JSON.stringify(message)
}

export function createAppRealtimeRequestId(): string {
  return createOpaqueId('req')
}
