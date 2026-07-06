// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []
  readonly url: string
  readyState = MockWebSocket.CONNECTING
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: Event) => void) {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(cb)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close')
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open')
  }

  emitMessage(data: unknown) {
    this.emit('message', { data } as MessageEvent)
  }

  private emit(type: string, event: Event = new Event(type)) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('websocket lifecycle', () => {
  beforeEach(() => {
    MockWebSocket.instances.length = 0
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket })
  })

  test('cancels pending idle close before a connecting socket opens', () => {
    let shouldKeepOpen = true
    const onOpen = vi.fn()
    const lifecycle = createWebSocketLifecycle({
      resolveConnection: () => ({ url: 'ws://example.test/socket' }),
      createSocket: (connection) => new WebSocket(connection.url),
      shouldOpen: () => true,
      shouldKeepOpen: () => shouldKeepOpen,
      onOpen,
    })

    lifecycle.ensureSocket()
    const socket = MockWebSocket.instances[0]
    if (!socket) throw new Error('missing socket')

    shouldKeepOpen = false
    expect(lifecycle.requestIdleClose()).toBe(true)
    shouldKeepOpen = true
    lifecycle.cancelIdleClose()
    socket.emitOpen()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(socket.readyState).toBe(MockWebSocket.OPEN)
  })

  test('forgets closing sockets before ensuring a fresh socket', () => {
    const lifecycle = createWebSocketLifecycle({
      resolveConnection: () => ({ url: 'ws://example.test/socket' }),
      createSocket: (connection) => new WebSocket(connection.url),
      shouldOpen: () => true,
      shouldKeepOpen: () => true,
    })

    const first = lifecycle.ensureSocket()
    if (!first) throw new Error('missing first socket')
    ;(first.socket as unknown as MockWebSocket).readyState = WebSocket.CLOSING

    const second = lifecycle.ensureSocket()

    expect(second).not.toBe(first)
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  test('ignores stale socket messages after a newer socket becomes active', () => {
    const onMessage = vi.fn()
    const lifecycle = createWebSocketLifecycle({
      resolveConnection: () => ({ url: 'ws://example.test/socket' }),
      createSocket: (connection) => new WebSocket(connection.url),
      shouldOpen: () => true,
      shouldKeepOpen: () => true,
      onMessage,
    })
    const first = lifecycle.ensureSocket()
    if (!first) throw new Error('missing first socket')
    ;(first.socket as unknown as MockWebSocket).readyState = WebSocket.CLOSED
    const second = lifecycle.ensureSocket()
    if (!second) throw new Error('missing second socket')

    ;(first.socket as unknown as MockWebSocket).emitMessage('stale')
    ;(second.socket as unknown as MockWebSocket).emitMessage('fresh')

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0]?.[0].data).toBe('fresh')
  })
})
