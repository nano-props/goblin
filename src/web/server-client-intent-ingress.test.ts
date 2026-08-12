// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('server client intent ingress', () => {
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
    const { resetServerClientIntentIngressForTests } = await import('#/web/server-client-intent-ingress.ts')
    resetServerClientIntentIngressForTests()
  })

  test('connects to the client-intent channel', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/server-client-intent-ingress.ts')
    const dispose = subscribeServerClientIntentIngress(() => {})

    expect(wsMock.instances[0]?.url).toContain('/ws/client-intent')
    dispose()
  })

  test('dispatches a valid client-effect-intent envelope', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/server-client-intent-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)

    wsMock.instances[0]?.emitMessage(
      JSON.stringify({
        type: 'client-effect-intent',
        intent: { type: 'show-workspace-pane-tab-requested', tab: 'changes' },
      }),
    )

    expect(listener).toHaveBeenCalledWith({ type: 'show-workspace-pane-tab-requested', tab: 'changes' })
    dispose()
  })

  test('drops malformed client-effect-intent envelopes', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/server-client-intent-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage('not json')
    socket.emitMessage(JSON.stringify({ type: 'something-else', intent: {} }))
    socket.emitMessage(JSON.stringify({ type: 'client-effect-intent', intent: { type: 'banana' } }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })

  test('rejects native-only lifecycle intents from the server ingress', async () => {
    const { subscribeServerClientIntentIngress } = await import('#/web/server-client-intent-ingress.ts')
    const listener = vi.fn()
    const dispose = subscribeServerClientIntentIngress(listener)
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage(JSON.stringify({ type: 'client-effect-intent', intent: { type: 'app-quitting' } }))

    expect(listener).not.toHaveBeenCalled()
    dispose()
  })
})
