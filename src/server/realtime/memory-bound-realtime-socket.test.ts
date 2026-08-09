import { describe, expect, test, vi } from 'vitest'
import {
  MAX_APP_REALTIME_SEND_BACKLOG_BYTES,
  MemoryBoundRealtimeSocket,
} from '#/server/realtime/memory-bound-realtime-socket.ts'

describe('MemoryBoundRealtimeSocket', () => {
  test('sends immediately while the raw sender queue remains within its memory limit', () => {
    const rawSocket = rawRealtimeSocket(MAX_APP_REALTIME_SEND_BACKLOG_BYTES)
    const socket = new MemoryBoundRealtimeSocket(rawSocket)

    socket.send('ok')

    expect(rawSocket.send).toHaveBeenCalledWith('ok')
    expect(rawSocket.terminate).not.toHaveBeenCalled()
  })

  test('admits one atomic message even when it crosses the pending-byte limit', () => {
    const rawSocket = rawRealtimeSocket(0)
    rawSocket.send.mockImplementation((data) => {
      rawSocket.bufferedAmount = Buffer.byteLength(data)
    })
    const socket = new MemoryBoundRealtimeSocket(rawSocket)
    const message = 'x'.repeat(MAX_APP_REALTIME_SEND_BACKLOG_BYTES + 1)

    socket.send(message)

    expect(rawSocket.send).toHaveBeenCalledWith(message)
    expect(rawSocket.terminate).not.toHaveBeenCalled()
  })

  test('terminates without queueing the next send after pending bytes cross the limit', () => {
    const rawSocket = rawRealtimeSocket(MAX_APP_REALTIME_SEND_BACKLOG_BYTES + 1)
    const socket = new MemoryBoundRealtimeSocket(rawSocket)

    expect(() => socket.send('x')).toThrow('app realtime pending send capacity exceeded')

    expect(rawSocket.send).not.toHaveBeenCalled()
    expect(rawSocket.terminate).toHaveBeenCalledOnce()
  })

  test('checks accumulated pending bytes again before every send', () => {
    const rawSocket = rawRealtimeSocket(0)
    rawSocket.send.mockImplementation((data) => {
      rawSocket.bufferedAmount += Buffer.byteLength(data)
    })
    const socket = new MemoryBoundRealtimeSocket(rawSocket)
    const message = 'x'.repeat(MAX_APP_REALTIME_SEND_BACKLOG_BYTES + 1)

    socket.send(message)
    expect(() => socket.send('next')).toThrow('app realtime pending send capacity exceeded')

    expect(rawSocket.send).toHaveBeenCalledOnce()
    expect(rawSocket.terminate).toHaveBeenCalledOnce()
  })

  test('terminates when the raw send fails', () => {
    const rawSocket = rawRealtimeSocket(0)
    rawSocket.send.mockImplementation(() => {
      throw new Error('send failed')
    })
    const socket = new MemoryBoundRealtimeSocket(rawSocket)

    expect(() => socket.send('x')).toThrow('send failed')

    expect(rawSocket.terminate).toHaveBeenCalledOnce()
  })

  test('keeps ordinary close graceful and force close immediate', () => {
    const gracefulRawSocket = rawRealtimeSocket(0)
    const forcedRawSocket = rawRealtimeSocket(0)

    new MemoryBoundRealtimeSocket(gracefulRawSocket).close(1001, 'done')
    new MemoryBoundRealtimeSocket(forcedRawSocket).forceClose()

    expect(gracefulRawSocket.close).toHaveBeenCalledWith(1001, 'done')
    expect(gracefulRawSocket.terminate).not.toHaveBeenCalled()
    expect(forcedRawSocket.close).not.toHaveBeenCalled()
    expect(forcedRawSocket.terminate).toHaveBeenCalledOnce()
  })

  test('terminates when graceful close fails', () => {
    const rawSocket = rawRealtimeSocket(0)
    rawSocket.close.mockImplementation(() => {
      throw new Error('close failed')
    })
    const socket = new MemoryBoundRealtimeSocket(rawSocket)

    expect(() => socket.close()).toThrow('close failed')

    expect(rawSocket.terminate).toHaveBeenCalledOnce()
  })
})

function rawRealtimeSocket(bufferedAmount: number) {
  return {
    bufferedAmount,
    send: vi.fn<(data: string) => void>(),
    close: vi.fn<(code?: number, reason?: string) => void>(),
    terminate: vi.fn<() => void>(),
  }
}
