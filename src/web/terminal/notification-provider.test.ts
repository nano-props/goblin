// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { onClientLocalEventType, resetClientLocalEventsForTests } from '#/web/bridge/local-events.ts'
import { createTerminalNotificationProvider } from '#/web/terminal/notification-provider.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

let wsMock: WebSocketMockHandle

const WORKSPACE_ID = canonicalWorkspaceLocator('goblin+file:///workspace')
if (!WORKSPACE_ID) throw new Error('invalid workspace locator fixture')

const bellInput = {
  title: 'repo',
  body: 'feature/test\nzsh',
  terminalSessionId: 'term-111111111111111111111',
  session: {
    target: {
      kind: 'workspace-root' as const,
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'workspace-runtime-test',
    },
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
  })

  test('uses browser notifications when the native provider is unavailable', async () => {
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

  test('keeps the browser provider selected when a native bridge appears later', async () => {
    const provider = createTerminalNotificationProvider()
    const notifyBell = vi.fn(async () => true)

    await expect(provider.notifyBell(bellInput)).resolves.toBe(true)

    expect(wsMock.notificationInstances).toHaveLength(1)
    expect(notifyBell).not.toHaveBeenCalled()
  })

  test('uses caller-provided copy for browser test notifications', async () => {
    await expect(createTerminalNotificationProvider().sendTestNotification(testNotificationInput)).resolves.toBe(true)

    expect(wsMock.notificationInstances).toHaveLength(1)
    expect(wsMock.notificationInstances[0]).toMatchObject({
      title: 'Test title',
      options: { body: 'Test body', silent: true },
    })
  })

  test('treats a synchronous browser permission failure as unavailable', async () => {
    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'default' })
    vi.spyOn(Notification, 'requestPermission').mockImplementation(() => {
      throw new Error('permission API unavailable')
    })

    await expect(createTerminalNotificationProvider().sendTestNotification(testNotificationInput)).resolves.toBe(false)

    expect(wsMock.notificationInstances).toHaveLength(0)
  })
})
