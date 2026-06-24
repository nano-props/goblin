// Generic renderer-side WebSocket subscription for the server's
// per-purpose `/ws/*` channels (`/ws/invalidation`,
// `/ws/client-intent`, future ones).
//
// Owns a single WebSocket connection per ingress instance:
//   - Lazy: opens on the first subscriber, closes when the last
//     subscriber unsubscribes.
//   - Auto-reconnects with a fixed delay after an unexpected close.
//   - Tracks a `socketGeneration` so a stale socket's events (open
//     / message / close) can never win against a fresher one.
//   - Shuts down cleanly when the app quits.
//
// The two consumers today are
//   `#/web/server-invalidation-ingress.ts` and
//   `#/web/server-renderer-intent-ingress.ts`; both reduce to
//   ~25 lines once they pick the path + parser and forward to this
// factory.

import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import { resolveRendererServerConfig } from '#/web/lib/server-config.ts'

const DEFAULT_RECONNECT_DELAY_MS = 300

export interface ServerWebSocketIngressConfig<T> {
  /** WebSocket path on the server, e.g. `/ws/invalidation`. */
  path: string
  /** Parse a raw message frame. Return `null` to silently drop. */
  parseMessage: (data: unknown) => T | null
  /** Reconnect delay after an unexpected close. Defaults to 300 ms. */
  reconnectDelayMs?: number
}

export interface ServerWebSocketIngress<T> {
  /** Subscribe to messages. Returns an unsubscribe function. */
  subscribe: (listener: (message: T) => void) => () => void
  /** Drop all listeners and close the underlying socket. Test-only. */
  resetForTests: () => void
}

export function createServerWebSocketIngress<T>(
  config: ServerWebSocketIngressConfig<T>,
): ServerWebSocketIngress<T> {
  const { path, parseMessage, reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS } = config

  const listeners = new Set<(message: T) => void>()
  let socket: WebSocket | null = null
  let manualSocketClose = false
  let socketGeneration = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function createSocketUrl(baseUrl: string, accessToken: string | null): string {
    const httpUrl = new URL(path, baseUrl)
    httpUrl.protocol = resolveWebSocketProtocol()
    // Browser path: cookie handles auth — don't pass `?t=`.
    // Embedded / dev path: WebSocket constructor can't set custom
    // headers, so the access token rides in the query string. The
    // server's WS middleware accepts all three (cookie, header, `?t=`).
    if (accessToken) httpUrl.searchParams.set(ACCESS_TOKEN_QUERY, accessToken)
    return httpUrl.toString()
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) return
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || listeners.size === 0 || isAppQuitting()) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      ensureSocket()
    }, reconnectDelayMs)
  }

  function ensureSocket(): void {
    const server = resolveRendererServerConfig()
    if (!server || typeof WebSocket === 'undefined' || socket || listeners.size === 0 || isAppQuitting()) return
    clearReconnectTimer()
    manualSocketClose = false
    const generation = (socketGeneration += 1)
    const currentSocket = new WebSocket(createSocketUrl(server.url, server.accessToken || null))
    socket = currentSocket
    currentSocket.addEventListener('open', () => {
      if (socket !== currentSocket || socketGeneration !== generation) return
      if (manualSocketClose && listeners.size === 0) {
        try {
          currentSocket.close()
        } catch {}
      }
    })
    currentSocket.addEventListener('message', (event) => {
      if (socket !== currentSocket || socketGeneration !== generation) return
      const message = parseMessage(event.data)
      if (message === null || message === undefined) return
      for (const listener of listeners) listener(message)
    })
    const cleanup = () => {
      if (socket !== currentSocket || socketGeneration !== generation) return
      const wasManual = manualSocketClose
      socket = null
      manualSocketClose = false
      if (wasManual) {
        if (listeners.size > 0) ensureSocket()
        return
      }
      scheduleReconnect()
    }
    currentSocket.addEventListener('close', cleanup)
    currentSocket.addEventListener('error', cleanup)
  }

  function maybeCloseSocket(): void {
    if (listeners.size > 0 || !socket) return
    manualSocketClose = true
    clearReconnectTimer()
    if (socket.readyState === WebSocket.CONNECTING) return
    try {
      socket.close()
    } catch {}
  }

  function closeSocketForQuit(): void {
    manualSocketClose = true
    clearReconnectTimer()
    const currentSocket = socket
    socket = null
    if (!currentSocket) return
    try {
      currentSocket.close()
    } catch {}
  }

  subscribeAppQuitting(closeSocketForQuit)

  return {
    subscribe(listener) {
      listeners.add(listener)
      manualSocketClose = false
      ensureSocket()
      return () => {
        listeners.delete(listener)
        maybeCloseSocket()
      }
    },
    resetForTests() {
      listeners.clear()
      manualSocketClose = false
      clearReconnectTimer()
      if (socket) {
        try {
          socket.close()
        } catch {}
      }
      socket = null
    },
  }
}
