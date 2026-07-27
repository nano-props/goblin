// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('server invalidation ingress', () => {
  let wsMock: WebSocketMockHandle

  beforeEach(() => {
    vi.resetModules()
    wsMock = installWebSocketMock({ autoOpen: false })
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'test-token' },
      },
    })
  })

  afterEach(async () => {
    const { resetServerInvalidationIngressForTests } = await import('#/web/server-invalidation-ingress.ts')
    resetServerInvalidationIngressForTests()
  })

  test('connects to the invalidation channel and dispatches valid events', async () => {
    const { subscribeServerInvalidationIngress } = await import('#/web/server-invalidation-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerInvalidationIngress(listener)

    expect(wsMock.instances[0]?.url).toContain('/ws/invalidation')
    wsMock.instances[0]?.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] }))

    expect(listener).toHaveBeenCalledWith({ type: 'settings-invalidated', scopes: ['theme'] })
    dispose()
  })

  test('drops malformed and unknown invalidation messages', async () => {
    const { subscribeServerInvalidationIngress } = await import('#/web/server-invalidation-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerInvalidationIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage('not json')
    socket.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['unknown'] }))
    socket.emitMessage(JSON.stringify({ type: 'unknown-event' }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })
})
