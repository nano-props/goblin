// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { onClientLocalEventType, resetClientLocalEventsForTests } from '#/web/local-events.ts'
import { createTerminalNotificationProvider } from '#/web/terminal-notification-provider.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

let wsMock: WebSocketMockHandle

const bellInput = {
  title: 'repo',
  body: 'feature/test\nzsh',
  key: '/tmp/repo\u0000/tmp/repo\u0000session-1',
  repoRoot: '/tmp/repo',
}

const testNotificationInput = {
  title: 'Test title',
  body: 'Test body',
}

describe('terminal notification provider', () => {
  beforeEach(() => {
    wsMock = installWebSocketMock()
    vi.restoreAllMocks()
    vi.resetModules()
    resetClientLocalEventsForTests()
    delete (window as Partial<Window>).goblinNative
  })

  test('uses the native notification provider when the preload exposes one', async () => {
    const notifyBell = vi.fn(async () => true)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: {
        terminal: {
          notifyBell,
        },
      },
    })

    await expect(createTerminalNotificationProvider().notifyBell(bellInput)).resolves.toBe(true)

    expect(notifyBell).toHaveBeenCalledWith(bellInput)
    expect(wsMock.notificationInstances).toHaveLength(0)
  })

  test('does not fall through to browser notifications when native handles the request as false', async () => {
    const notifyBell = vi.fn(async () => false)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: {
        terminal: {
          notifyBell,
        },
      },
    })

    await expect(createTerminalNotificationProvider().notifyBell(bellInput)).resolves.toBe(false)

    expect(notifyBell).toHaveBeenCalledWith(bellInput)
    expect(wsMock.notificationInstances).toHaveLength(0)
  })

  test('falls back to browser notifications when no native notification provider exists', async () => {
    const bellClick = vi.fn()
    const dispose = onClientLocalEventType('terminal-bell-click', bellClick)

    await expect(createTerminalNotificationProvider().notifyBell(bellInput)).resolves.toBe(true)
    wsMock.notificationInstances[0]?.onclick?.()

    expect(wsMock.notificationInstances).toHaveLength(1)
    expect(bellClick).toHaveBeenCalledWith({
      type: 'terminal-bell-click',
      repoRoot: '/tmp/repo',
      key: '/tmp/repo\u0000/tmp/repo\u0000session-1',
    })
    dispose()
  })

  test('sends test notifications through the same provider chain', async () => {
    const sendTestNotification = vi.fn(async () => true)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: {
        terminal: {
          sendTestNotification,
        },
      },
    })

    await expect(createTerminalNotificationProvider().sendTestNotification(testNotificationInput)).resolves.toBe(true)

    expect(sendTestNotification).toHaveBeenCalledWith(testNotificationInput)
    expect(wsMock.notificationInstances).toHaveLength(0)
  })

  test('uses caller-provided copy for browser test notifications', async () => {
    await expect(createTerminalNotificationProvider().sendTestNotification(testNotificationInput)).resolves.toBe(true)

    expect(wsMock.notificationInstances).toHaveLength(1)
    expect(wsMock.notificationInstances[0]).toMatchObject({
      title: 'Test title',
      options: { body: 'Test body', silent: true },
    })
  })
})
