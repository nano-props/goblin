// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/index.ts'
import { installWebSocketMock, type WebSocketMockHandle } from '#/web/test-utils/websocket-mock.ts'

describe('installWebSocketMock', () => {
  test('auto-open flavor transitions to OPEN on the next microtask', async () => {
    const handle = installWebSocketMock({ autoOpen: true })
    const socket = new handle.MockWebSocket('ws://test/')
    expect(socket.readyState).toBe(0)
    await flushMicrotasks(2)
    expect(socket.readyState).toBe(1)
  })

  test('manual-open flavor stays CONNECTING until emitOpen()', () => {
    const handle = installWebSocketMock({ autoOpen: false })
    const socket = new handle.MockWebSocket('ws://test/')
    expect(socket.readyState).toBe(0)
    socket.emitOpen()
    expect(socket.readyState).toBe(1)
  })

  test('emitMessage delivers parsed data to onmessage listeners', () => {
    const handle = installWebSocketMock({ autoOpen: false })
    const socket = new handle.MockWebSocket('ws://test/')
    const cb = vi.fn()
    socket.addEventListener('message', cb)
    socket.emitMessage('hello')
    expect(cb).toHaveBeenCalledWith({ data: 'hello' })
  })

  test('reset() clears tracked instances', () => {
    const handle: WebSocketMockHandle = installWebSocketMock({ autoOpen: false })
    new handle.MockWebSocket('ws://a/')
    new handle.MockWebSocket('ws://b/')
    expect(handle.instances).toHaveLength(2)
    handle.reset()
    expect(handle.instances).toHaveLength(0)
  })
})
