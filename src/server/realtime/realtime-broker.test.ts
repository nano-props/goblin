import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  REALTIME_HEARTBEAT_DEADLINE_MS,
  REALTIME_HEARTBEAT_INTERVAL_MS,
  RealtimeBroker,
} from '#/server/realtime/realtime-broker.ts'
import { BufferedRealtimeSocket } from '#/server/realtime/buffered-realtime-socket.ts'

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
})
