import { isServerInvalidationEvent, type ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { isRepoViewClientIntent, type RepoViewClientIntent } from '#/shared/client-effect-intents.ts'

export type ServerNotification =
  ServerInvalidationEvent | { type: 'client-effect-intent'; intent: RepoViewClientIntent }
export type NotificationSubscription = { type: 'client-intent-subscription'; enabled: boolean }

export function isServerNotification(value: unknown): value is ServerNotification {
  if (isServerInvalidationEvent(value)) return true
  return (
    !!value &&
    typeof value === 'object' &&
    Reflect.get(value, 'type') === 'client-effect-intent' &&
    isRepoViewClientIntent(Reflect.get(value, 'intent'))
  )
}

export function isNotificationSubscription(value: unknown): value is NotificationSubscription {
  return (
    !!value &&
    typeof value === 'object' &&
    Reflect.get(value, 'type') === 'client-intent-subscription' &&
    typeof Reflect.get(value, 'enabled') === 'boolean' &&
    Object.keys(value).length === 2
  )
}
