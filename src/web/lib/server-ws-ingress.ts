// Generic client-side WebSocket subscription for the server's
// per-purpose `/ws/*` channels (`/ws/invalidation`,
// `/ws/client-intent`, future ones).
//
// Owns a single WebSocket connection per ingress instance:
//   - Lazy: opens on the first subscriber, closes when the last
//     subscriber unsubscribes.
//   - Auto-reconnects with a fixed delay after an unexpected close.
//   - Uses the shared WebSocket lifecycle so stale socket events and
//     idle-close intent are scoped to the active socket generation.
//   - Shuts down cleanly when the app quits.
//
// The two consumers today are
//   `#/web/server-invalidation-ingress.ts` and
//   `#/web/server-client-intent-ingress.ts`; both reduce to
//   ~25 lines once they pick the path + parser and forward to this
// factory.

import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import { resolveClientServerConfig } from '#/web/lib/server-config.ts'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'

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

export function createServerWebSocketIngress<T>(config: ServerWebSocketIngressConfig<T>): ServerWebSocketIngress<T> {
  const { path, parseMessage, reconnectDelayMs = 300 } = config

  const listeners = new Set<(message: T) => void>()
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const socketLifecycle = createWebSocketLifecycle({
    resolveConnection() {
      const server = resolveClientServerConfig()
      if (!server) return null
      return { url: createSocketUrl(server.url, server.accessToken || null) }
    },
    createSocket(connection) {
      return new WebSocket(connection.url)
    },
    shouldOpen() {
      return typeof WebSocket !== 'undefined' && listeners.size > 0 && !isAppQuitting()
    },
    shouldKeepOpen() {
      return listeners.size > 0
    },
    onMessage(event) {
      const message = parseMessage(event.data)
      if (message === null || message === undefined) return
      for (const listener of listeners) listener(message)
    },
    onDisconnect(_entry, context) {
      if (context.idleClose) {
        if (listeners.size > 0) ensureSocket()
        return
      }
      scheduleReconnect()
    },
  })

  function createSocketUrl(baseUrl: string, accessToken: string | null): string {
    const httpUrl = new URL(path, baseUrl)
    httpUrl.protocol = resolveWebSocketProtocol(baseUrl)
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
    clearReconnectTimer()
    socketLifecycle.ensureSocket()
  }

  function maybeCloseSocket(): void {
    if (listeners.size > 0) return
    clearReconnectTimer()
    socketLifecycle.requestIdleClose()
  }

  function closeSocketForQuit(): void {
    clearReconnectTimer()
    socketLifecycle.closeAndForget()
  }

  subscribeAppQuitting(closeSocketForQuit)

  return {
    subscribe(listener) {
      listeners.add(listener)
      socketLifecycle.cancelIdleClose()
      ensureSocket()
      return () => {
        listeners.delete(listener)
        maybeCloseSocket()
      }
    },
    resetForTests() {
      listeners.clear()
      clearReconnectTimer()
      socketLifecycle.closeAndForget()
    },
  }
}
