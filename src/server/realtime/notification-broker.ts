import type { ServerNotification } from '#/shared/server-notification.ts'
import type { RepoViewClientIntent } from '#/shared/client-effect-intents.ts'

interface NotificationSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

export const MAX_NOTIFICATION_SOCKETS = 32

export class NotificationSocketLimitError extends Error {
  constructor() {
    super(`Too many notification subscribers (max ${MAX_NOTIFICATION_SOCKETS})`)
    this.name = 'NotificationSocketLimitError'
  }
}

const sockets = new Map<NotificationSocket, { userId: string; acceptsClientIntents: boolean }>()

export function registerNotificationSocket(socket: NotificationSocket, userId: string): void {
  if (sockets.size >= MAX_NOTIFICATION_SOCKETS) throw new NotificationSocketLimitError()
  sockets.set(socket, { userId, acceptsClientIntents: false })
}

export function setNotificationClientIntentSubscription(socket: NotificationSocket, enabled: boolean): void {
  const subscription = sockets.get(socket)
  if (subscription) subscription.acceptsClientIntents = enabled
}

export function unregisterNotificationSocket(socket: NotificationSocket): void {
  sockets.delete(socket)
}

export function disconnectAllNotificationSockets(): void {
  for (const socket of Array.from(sockets.keys())) {
    try {
      socket.close(1001, 'server shutting down')
    } catch {}
  }
  sockets.clear()
}

export function publishNotification(message: ServerNotification, userId?: string): boolean {
  let hasReceiver = false
  const payload = JSON.stringify(message)
  for (const [socket, subscription] of Array.from(sockets)) {
    if (userId && subscription.userId !== userId) continue
    if (message.type === 'client-effect-intent' && !subscription.acceptsClientIntents) continue
    hasReceiver = true
    try {
      socket.send(payload)
    } catch {
      unregisterNotificationSocket(socket)
    }
  }
  return hasReceiver
}

// Presence of a receiver is best-effort; this does not acknowledge execution.
export function publishClientIntent(intent: RepoViewClientIntent): boolean {
  return publishNotification({ type: 'client-effect-intent', intent })
}
