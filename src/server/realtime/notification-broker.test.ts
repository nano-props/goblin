import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllNotificationSockets,
  MAX_NOTIFICATION_SOCKETS,
  publishClientIntent,
  registerNotificationSocket,
  NotificationSocketLimitError,
  unregisterNotificationSocket,
  setNotificationClientIntentSubscription,
  publishNotification,
} from '#/server/realtime/notification-broker.ts'

describe('notification broker', () => {
  beforeEach(() => {
    disconnectAllNotificationSockets()
  })

  test('returns false when no subscriber is attached', () => {
    expect(publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })).toBe(false)
  })

  test('broadcasts the enveloped intent to every subscriber and returns true', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(first, 'user_a')
    setNotificationClientIntentSubscription(first, true)
    registerNotificationSocket(second, 'user_a')
    setNotificationClientIntentSubscription(second, true)

    const ok = publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })
    expect(ok).toBe(true)

    const expected = JSON.stringify({
      type: 'client-effect-intent',
      intent: { type: 'show-workspace-pane-tab-requested', tab: 'changes' },
    })
    expect(first.send).toHaveBeenCalledWith(expected)
    expect(second.send).toHaveBeenCalledWith(expected)
  })

  test('removes a subscriber after delivery fails', () => {
    const subscriber = {
      send: vi.fn(() => {
        throw new Error('socket closed')
      }),
      close: vi.fn(),
    }
    registerNotificationSocket(subscriber, 'user_a')
    setNotificationClientIntentSubscription(subscriber, true)

    expect(publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })).toBe(true)
    expect(publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })).toBe(false)
    expect(subscriber.send).toHaveBeenCalledOnce()
  })

  test('shares one socket across invalidations and opted-in client intents', () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(socket, 'user_a')
    const intent = { type: 'show-workspace-pane-tab-requested' as const, tab: 'changes' as const }
    expect(publishClientIntent(intent)).toBe(false)
    expect(publishNotification({ type: 'settings-invalidated', scopes: ['theme'] })).toBe(true)
    setNotificationClientIntentSubscription(socket, true)
    expect(publishClientIntent(intent)).toBe(true)
    setNotificationClientIntentSubscription(socket, false)
    expect(publishClientIntent(intent)).toBe(false)
    expect(socket.send).toHaveBeenCalledTimes(2)
  })

  test('disconnects every subscriber during shutdown', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerNotificationSocket(first, 'user_a')
    setNotificationClientIntentSubscription(first, true)
    registerNotificationSocket(second, 'user_a')
    setNotificationClientIntentSubscription(second, true)

    disconnectAllNotificationSockets()
    publishClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(first.send).not.toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('rejects the (N+1)th subscriber to prevent socket floods', () => {
    for (let i = 0; i < MAX_NOTIFICATION_SOCKETS; i += 1) {
      registerNotificationSocket({ send: vi.fn(), close: vi.fn() }, 'user_a')
    }
    const overflow = { send: vi.fn(), close: vi.fn() }
    expect(() => registerNotificationSocket(overflow, 'user_a')).toThrow(NotificationSocketLimitError)
  })

  test('frees a slot when a subscriber disconnects', () => {
    const sockets = Array.from({ length: MAX_NOTIFICATION_SOCKETS }, () => ({
      send: vi.fn(),
      close: vi.fn(),
    }))
    for (const s of sockets) registerNotificationSocket(s, 'user_a')
    unregisterNotificationSocket(sockets[0]!)
    expect(() => registerNotificationSocket({ send: vi.fn(), close: vi.fn() }, 'user_a')).not.toThrow()
  })
})
