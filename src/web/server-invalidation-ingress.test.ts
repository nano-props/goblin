// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: any) => void>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: any) => void) {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(cb)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', {})
  }

  emitMessage(data: unknown) {
    this.emit('message', { data })
  }

  private emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('server invalidation source', () => {
  beforeEach(() => {
    vi.resetModules()
    MockWebSocket.instances.length = 0
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket })
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
        homeDir: '',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:5173/', secret: 'secret', clientId: 'client_sharedterminal' },
      },
    })
  })

  test('reuses a connecting socket when listeners unsubscribe and resubscribe before close completes', async () => {
    const { resetServerInvalidationIngressForTests, subscribeServerInvalidationIngress } = await import(
      '#/web/server-invalidation-ingress.ts'
    )

    const disposeFirst = subscribeServerInvalidationIngress(() => {})
    expect(MockWebSocket.instances).toHaveLength(1)

    disposeFirst()
    const disposeSecond = subscribeServerInvalidationIngress(() => {})
    expect(MockWebSocket.instances).toHaveLength(1)

    MockWebSocket.instances[0]?.emitOpen()
    disposeSecond()
    resetServerInvalidationIngressForTests()
  })

  test('ignores stale invalidation socket events after reconnect creates a newer socket', async () => {
    vi.useFakeTimers()
    const { resetServerInvalidationIngressForTests, subscribeServerInvalidationIngress } = await import(
      '#/web/server-invalidation-ingress.ts'
    )
    const listener = vi.fn()
    const dispose = subscribeServerInvalidationIngress(listener)
    const firstSocket = MockWebSocket.instances[0]
    if (!firstSocket) throw new Error('missing initial invalidation socket')

    firstSocket.close()
    await vi.advanceTimersByTimeAsync(300)

    const secondSocket = MockWebSocket.instances[1]
    if (!secondSocket) throw new Error('missing reconnected invalidation socket')

    firstSocket.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] }))
    secondSocket.emitMessage(JSON.stringify({ type: 'settings-invalidated', scopes: ['theme'] }))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'settings-invalidated', scopes: ['theme'] })
    dispose()
    resetServerInvalidationIngressForTests()
    vi.useRealTimers()
  })

  test('stops reconnecting invalidation sockets after app quitting starts', async () => {
    vi.useFakeTimers()
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')
    const { resetServerInvalidationIngressForTests, subscribeServerInvalidationIngress } = await import(
      '#/web/server-invalidation-ingress.ts'
    )
    const dispose = subscribeServerInvalidationIngress(() => {})
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing initial invalidation socket')

    markAppQuitting()
    await vi.advanceTimersByTimeAsync(300)

    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(MockWebSocket.instances).toHaveLength(1)
    dispose()
    resetServerInvalidationIngressForTests()
    vi.useRealTimers()
  })
})
