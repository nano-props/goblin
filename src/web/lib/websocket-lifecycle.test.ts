// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('websocket lifecycle', () => {
  let wsMock: WebSocketMockHandle

  beforeEach(() => {
    wsMock = installWebSocketMock({ autoOpen: false })
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
    const socket = wsMock.instances[0]
    if (!socket) throw new Error('missing socket')

    shouldKeepOpen = false
    expect(lifecycle.requestIdleClose()).toBe(true)
    shouldKeepOpen = true
    lifecycle.cancelIdleClose()
    socket.emitOpen()

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(socket.readyState).toBe(wsMock.OPEN)
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
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing first mock socket')
    firstSocket.readyState = wsMock.CLOSING

    const second = lifecycle.ensureSocket()

    expect(second).not.toBe(first)
    expect(wsMock.instances).toHaveLength(2)
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
    const firstSocket = wsMock.instances[0]
    if (!firstSocket) throw new Error('missing first mock socket')
    firstSocket.readyState = wsMock.CLOSED
    const second = lifecycle.ensureSocket()
    if (!second) throw new Error('missing second socket')

    wsMock.instances[0]?.emitMessage('stale')
    wsMock.instances[1]?.emitMessage('fresh')

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage.mock.calls[0]?.[0].data).toBe('fresh')
  })
})
