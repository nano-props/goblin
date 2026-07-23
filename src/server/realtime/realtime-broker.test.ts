import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AppRealtimeSocketLimitError,
  MAX_APP_REALTIME_SOCKETS,
  REALTIME_HEARTBEAT_DEADLINE_MS,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  RealtimeBroker,
} from '#/server/realtime/realtime-broker.ts'
import {
  BufferedRealtimeSocket,
  MAX_BUFFERED_REALTIME_BYTES,
  MAX_BUFFERED_REALTIME_ENTRIES,
} from '#/server/realtime/buffered-realtime-socket.ts'

const USER_ID = 'user_realtime'
const TEST_NOW = new Date('2026-06-24T00:00:00Z')
const HEARTBEAT_SILENCE_MS = REALTIME_HEARTBEAT_DEADLINE_MS + REALTIME_HEARTBEAT_INTERVAL_MS

describe('realtime broker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('fans out typed feature messages without owning the feature domain', () => {
    const broker = new RealtimeBroker<{ type: 'feature.changed'; value: string }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', USER_ID, socket)

    broker.broadcastToUser(USER_ID, { type: 'feature.changed', value: 'ok' })

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'feature.changed', value: 'ok' }))
    broker.disconnectAll()
  })

  test('uses transport heartbeat defaults independently from terminal naming', () => {
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained: vi.fn(),
    })
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    bufferedSocket.pause()
    broker.registerSocket('client_a', USER_ID, bufferedSocket)

    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)

    expect(rawSocket.close).toHaveBeenCalledWith(1001, 'realtime heartbeat timeout')
    expect(broker.hasUserSockets(USER_ID)).toBe(false)
    broker.disconnectAll()
  })

  test('closes a paused socket when buffered bytes exceed the transport budget', () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const onDeactivate = vi.fn()
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket, onDeactivate)
    bufferedSocket.pause()

    bufferedSocket.send('x'.repeat(MAX_BUFFERED_REALTIME_BYTES))
    bufferedSocket.send('x')

    expect(rawSocket.send).not.toHaveBeenCalled()
    expect(rawSocket.close).toHaveBeenCalledWith(1013, 'realtime buffer capacity exceeded')
    expect(onDeactivate).toHaveBeenCalledOnce()
  })

  test('closes a paused socket when buffered event count exceeds the transport budget', () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    bufferedSocket.pause()

    for (let index = 0; index < MAX_BUFFERED_REALTIME_ENTRIES; index += 1) bufferedSocket.send('')
    bufferedSocket.send('')

    expect(rawSocket.send).not.toHaveBeenCalled()
    expect(rawSocket.close).toHaveBeenCalledWith(1013, 'realtime buffer capacity exceeded')
  })

  test('rejects new sockets at the admission limit without counting duplicate registration', () => {
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained: vi.fn(),
    })
    const sockets = Array.from({ length: MAX_APP_REALTIME_SOCKETS }, () => ({ send: vi.fn(), close: vi.fn() }))
    sockets.forEach((socket, index) => broker.registerSocket(`client_${index}`, USER_ID, socket))

    expect(() => broker.registerSocket('client_0', USER_ID, sockets[0]!)).not.toThrow()
    expect(() => broker.registerSocket('overflow', USER_ID, { send: vi.fn(), close: vi.fn() })).toThrow(
      AppRealtimeSocketLimitError,
    )
    expect(broker.socketCount()).toBe(MAX_APP_REALTIME_SOCKETS)
    broker.disconnectAll()
  })
})
