// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { onClientLocalEventType, resetClientLocalEventsForTests } from '#/web/local-events.ts'
import { createTerminalNotificationProvider } from '#/web/terminal-notification-provider.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

let wsMock: WebSocketMockHandle

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace')
if (!WORKSPACE_ID) throw new Error('invalid workspace locator fixture')

const bellInput = {
  title: 'repo',
  body: 'feature/test\nzsh',
  terminalSessionId: 'term-111111111111111111111',
  session: {
    target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'workspace-runtime-test' },
    presentation: { kind: 'workspace-root' as const },
  },
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
      value: currentNativeBridge({
        terminal: {
          notifyBell,
          sendTestNotification: async () => true,
          setBadge: () => {},
        },
      }),
    })

    await expect(createTerminalNotificationProvider().notifyBell(bellInput)).resolves.toBe(true)

    expect(notifyBell).toHaveBeenCalledWith(bellInput)
    expect(wsMock.notificationInstances).toHaveLength(0)
  })

  test('does not fall through to browser notifications when native handles the request as false', async () => {
    const notifyBell = vi.fn(async () => false)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: currentNativeBridge({
        terminal: {
          notifyBell,
          sendTestNotification: async () => true,
          setBadge: () => {},
        },
      }),
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
      terminalSessionId: 'term-111111111111111111111',
      session: bellInput.session,
    })
    dispose()
  })

  test('sends test notifications through the same provider chain', async () => {
    const sendTestNotification = vi.fn(async () => true)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: currentNativeBridge({
        terminal: {
          notifyBell: async () => true,
          sendTestNotification,
          setBadge: () => {},
        },
      }),
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
