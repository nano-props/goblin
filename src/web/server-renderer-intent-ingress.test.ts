// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: unknown) => void) {
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

  private emit(type: string, event: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function installBootstrap(url: string | null, accessToken: string | null) {
  Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
    configurable: true,
    value: {
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: url && accessToken !== null ? { url, accessToken, clientId: 'cid' } : null,
    },
  })
}

describe('server renderer intent source', () => {
  beforeEach(() => {
    vi.resetModules()
    MockWebSocket.instances.length = 0
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket })
  })

  test('connects to /ws/client-intent on the resolved server URL', async () => {
    installBootstrap('http://127.0.0.1:32100/', 'tok')
    const { resetServerRendererIntentIngressForTests, subscribeServerRendererIntentIngress } =
      await import('#/web/server-renderer-intent-ingress.ts')

    const dispose = subscribeServerRendererIntentIngress(() => {})
    const expected = new URL('/ws/client-intent', 'http://127.0.0.1:32100/')
    expected.protocol = 'ws:'
    expected.searchParams.set('t', 'tok')
    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0]?.url).toBe(expected.toString())
    dispose()
    resetServerRendererIntentIngressForTests()
  })

  test('dispatches a valid renderer-effect-intent envelope to the listener', async () => {
    installBootstrap('http://127.0.0.1:32100/', 'tok')
    const { resetServerRendererIntentIngressForTests, subscribeServerRendererIntentIngress } =
      await import('#/web/server-renderer-intent-ingress.ts')

    const listener = vi.fn()
    const dispose = subscribeServerRendererIntentIngress(listener)
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing socket')

    socket.emitMessage(
      JSON.stringify({
        type: 'renderer-effect-intent',
        intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
      }),
    )

    expect(listener).toHaveBeenCalledWith({
      type: 'show-workspace-pane-view-requested',
      tab: 'changes',
    })
    dispose()
    resetServerRendererIntentIngressForTests()
  })

  test('silently drops malformed envelopes', async () => {
    installBootstrap('http://127.0.0.1:32100/', 'tok')
    const { resetServerRendererIntentIngressForTests, subscribeServerRendererIntentIngress } =
      await import('#/web/server-renderer-intent-ingress.ts')

    const listener = vi.fn()
    const dispose = subscribeServerRendererIntentIngress(listener)
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing socket')

    // Wrong envelope discriminator.
    socket.emitMessage(JSON.stringify({ type: 'something-else', intent: {} }))
    // Right discriminator but invalid intent shape.
    socket.emitMessage(JSON.stringify({ type: 'renderer-effect-intent', intent: { type: 'banana' } }))
    // Garbage payload.
    socket.emitMessage('not json')

    expect(listener).not.toHaveBeenCalled()
    dispose()
    resetServerRendererIntentIngressForTests()
  })

  test('reconnects after unexpected close and ignores stale socket events', async () => {
    vi.useFakeTimers()
    installBootstrap('http://127.0.0.1:32100/', 'tok')
    const { resetServerRendererIntentIngressForTests, subscribeServerRendererIntentIngress } =
      await import('#/web/server-renderer-intent-ingress.ts')

    const listener = vi.fn()
    const dispose = subscribeServerRendererIntentIngress(listener)
    const firstSocket = MockWebSocket.instances[0]
    if (!firstSocket) throw new Error('missing initial socket')

    firstSocket.close()
    await vi.advanceTimersByTimeAsync(300)

    const secondSocket = MockWebSocket.instances[1]
    if (!secondSocket) throw new Error('missing reconnected socket')

    const payload = JSON.stringify({
      type: 'renderer-effect-intent',
      intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
    })
    firstSocket.emitMessage(payload) // stale; should be ignored
    secondSocket.emitMessage(payload) // fresh; should be delivered

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      type: 'show-workspace-pane-view-requested',
      tab: 'changes',
    })
    dispose()
    resetServerRendererIntentIngressForTests()
    vi.useRealTimers()
  })

  test('stops reconnecting after app quitting starts', async () => {
    vi.useFakeTimers()
    installBootstrap('http://127.0.0.1:32100/', 'tok')
    const { markAppQuitting } = await import('#/web/app-lifecycle.ts')
    const { resetServerRendererIntentIngressForTests, subscribeServerRendererIntentIngress } =
      await import('#/web/server-renderer-intent-ingress.ts')

    const dispose = subscribeServerRendererIntentIngress(() => {})
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing socket')

    markAppQuitting()
    await vi.advanceTimersByTimeAsync(300)

    expect(socket.readyState).toBe(MockWebSocket.CLOSED)
    expect(MockWebSocket.instances).toHaveLength(1)
    dispose()
    resetServerRendererIntentIngressForTests()
    vi.useRealTimers()
  })
})
