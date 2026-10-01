import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import { resolveClientServerConfig } from '#/web/lib/server-config.ts'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'
import {
  isServerNotification,
  type ServerNotification,
  type NotificationSubscription,
} from '#/shared/server-notification.ts'
import type { ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import type { RepoViewClientIntent } from '#/shared/client-effect-intents.ts'

type NotificationListener = {
  listener: (message: ServerNotification) => void
  onOpen?: () => void
  clientIntent: boolean
}

const subscriptions = new Set<NotificationListener>()
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
    return typeof WebSocket !== 'undefined' && subscriptions.size > 0
  },
  shouldKeepOpen() {
    return subscriptions.size > 0
  },
  onOpen() {
    declareClientIntentSubscription()
    for (const subscription of subscriptions) subscription.onOpen?.()
  },
  onMessage(event) {
    const message = parseNotification(event.data)
    if (message === null || message === undefined) return
    for (const subscription of subscriptions) subscription.listener(message)
  },
  onDisconnect(_entry, context) {
    if (context.idleClose) {
      if (subscriptions.size > 0) ensureSocket()
      return
    }
    scheduleReconnect()
  },
})

function createSocketUrl(baseUrl: string, accessToken: string | null): string {
  const httpUrl = new URL('/ws/notifications', baseUrl)
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
  if (reconnectTimer !== null || subscriptions.size === 0) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    ensureSocket()
  }, 300)
}

function ensureSocket(): void {
  clearReconnectTimer()
  socketLifecycle.ensureSocket()
}

function maybeCloseSocket(): void {
  if (subscriptions.size > 0) return
  clearReconnectTimer()
  socketLifecycle.requestIdleClose()
}

function subscribe(subscription: NotificationListener): () => void {
  const previouslyAcceptingIntents = acceptsClientIntents()
  subscriptions.add(subscription)
  socketLifecycle.cancelIdleClose()
  if (socketLifecycle.active()?.phase === 'open') {
    if (previouslyAcceptingIntents !== acceptsClientIntents()) declareClientIntentSubscription()
    subscription.onOpen?.()
  }
  ensureSocket()
  return () => {
    const previouslyAcceptingIntents = acceptsClientIntents()
    if (!subscriptions.delete(subscription)) return
    if (subscriptions.size > 0 && previouslyAcceptingIntents !== acceptsClientIntents()) {
      declareClientIntentSubscription()
    }
    maybeCloseSocket()
  }
}

function acceptsClientIntents(): boolean {
  return Array.from(subscriptions).some((subscription) => subscription.clientIntent)
}

function declareClientIntentSubscription(): void {
  const current = socketLifecycle.active()
  if (!current || current.phase !== 'open') return
  const message: NotificationSubscription = { type: 'client-intent-subscription', enabled: acceptsClientIntents() }
  try {
    current.socket.send(JSON.stringify(message))
  } catch {
    socketLifecycle.disconnect('notification subscription send failed', current.socket)
  }
}

function parseNotification(data: unknown): ServerNotification | null {
  if (typeof data !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(data)
    return isServerNotification(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function subscribeServerInvalidationIngress(
  listener: (event: ServerInvalidationEvent) => void,
  onOpen?: () => void,
): () => void {
  return subscribe({
    listener(message) {
      if (message.type !== 'client-effect-intent') listener(message)
    },
    onOpen,
    clientIntent: false,
  })
}

export function subscribeServerClientIntentIngress(listener: (intent: RepoViewClientIntent) => void): () => void {
  return subscribe({
    listener(message) {
      if (message.type === 'client-effect-intent') listener(message.intent)
    },
    clientIntent: true,
  })
}

export function resetServerNotificationIngressForTests(): void {
  subscriptions.clear()
  clearReconnectTimer()
  socketLifecycle.closeAndForget()
}
