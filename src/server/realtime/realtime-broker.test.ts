import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  AppRealtimeSocketLimitError,
  MAX_APP_REALTIME_SOCKETS,
  REALTIME_LIVENESS_DEADLINE_MS,
  REALTIME_LIVENESS_PROBE_INTERVAL_MS,
  RealtimeBroker,
} from '#/server/realtime/realtime-broker.ts'
import {
  BufferedRealtimeSocket,
  MAX_BUFFERED_REALTIME_BYTES,
  MAX_BUFFERED_REALTIME_ENTRIES,
  MAX_QUEUED_REALTIME_TRANSITIONS,
} from '#/server/realtime/buffered-realtime-socket.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { useFakeTimers } from '#/test-utils/timers.ts'

const USER_ID = 'user_realtime'
const OTHER_USER_ID = 'user_other'
const TEST_NOW = new Date('2026-06-24T00:00:00Z')
const LIVENESS_SILENCE_MS = REALTIME_LIVENESS_DEADLINE_MS + REALTIME_LIVENESS_PROBE_INTERVAL_MS

describe('realtime broker', () => {
  beforeEach(() => {
    useFakeTimers()
    vi.setSystemTime(TEST_NOW)
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

  test('uses transport liveness defaults independently from terminal naming', () => {
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained: vi.fn(),
    })
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    bufferedSocket.enqueueTransition(() => new Promise(() => {}))
    broker.registerSocket('client_a', USER_ID, bufferedSocket)

    vi.advanceTimersByTime(LIVENESS_SILENCE_MS)

    expect(rawSocket.close).toHaveBeenCalledWith(1001, 'realtime liveness timeout')
    expect(broker.hasUserSockets(USER_ID)).toBe(false)
    broker.disconnectAll()
  })

  test('closes an ordering transition when buffered bytes exceed the transport budget', () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const onRelease = vi.fn()
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket, onRelease)
    bufferedSocket.enqueueTransition(() => new Promise(() => {}))

    bufferedSocket.send('x'.repeat(MAX_BUFFERED_REALTIME_BYTES))
    bufferedSocket.send('x')

    expect(rawSocket.send).not.toHaveBeenCalled()
    expect(rawSocket.close).toHaveBeenCalledWith(1013, 'realtime buffer capacity exceeded')
    expect(onRelease).toHaveBeenCalledOnce()
  })

  test('closes an ordering transition when buffered event count exceeds the transport budget', () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    bufferedSocket.enqueueTransition(() => new Promise(() => {}))

    for (let index = 0; index < MAX_BUFFERED_REALTIME_ENTRIES; index += 1) bufferedSocket.send('')
    bufferedSocket.send('')

    expect(rawSocket.send).not.toHaveBeenCalled()
    expect(rawSocket.close).toHaveBeenCalledWith(1013, 'realtime buffer capacity exceeded')
  })

  test('serializes response transitions and flushes each transition before starting the next', async () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    const firstReady = Promise.withResolvers<void>()
    const started: string[] = []

    bufferedSocket.enqueueTransition(async () => {
      started.push('first')
      bufferedSocket.send('event:first')
      await firstReady.promise
      rawSocket.send('response:first')
      return null
    })
    bufferedSocket.enqueueTransition(async () => {
      started.push('second')
      bufferedSocket.send('event:second')
      rawSocket.send('response:second')
      return null
    })

    expect(started).toEqual(['first'])
    expect(rawSocket.send).not.toHaveBeenCalled()

    firstReady.resolve()
    await vi.waitFor(() => expect(rawSocket.send).toHaveBeenCalledTimes(4))

    expect(started).toEqual(['first', 'second'])
    expect(rawSocket.send.mock.calls.map(([payload]) => payload)).toEqual([
      'response:first',
      'event:first',
      'response:second',
      'event:second',
    ])
  })

  test('closes and clears a socket whose transition queue exceeds its resource limit', async () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)
    const activeTransition = Promise.withResolvers<null>()
    const queuedTransition = vi.fn(async () => null)

    bufferedSocket.enqueueTransition(() => activeTransition.promise)
    for (let index = 0; index < MAX_QUEUED_REALTIME_TRANSITIONS; index += 1) {
      bufferedSocket.enqueueTransition(queuedTransition)
    }
    bufferedSocket.enqueueTransition(queuedTransition)

    expect(rawSocket.close).toHaveBeenCalledWith(1013, 'realtime transition capacity exceeded')
    activeTransition.resolve(null)
    await flushMicrotasks()
    expect(queuedTransition).not.toHaveBeenCalled()
  })

  test('closes the raw transport when an ordering transition fails', async () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const onRelease = vi.fn()
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket, onRelease)

    bufferedSocket.enqueueTransition(async () => {
      throw new Error('response send failed')
    })

    await vi.waitFor(() => expect(rawSocket.close).toHaveBeenCalledWith(1011, 'realtime transition failed'))
    expect(onRelease).toHaveBeenCalledOnce()
  })

  test('uses immediate transport shutdown for a forced buffered-socket close', () => {
    const rawSocket = { send: vi.fn(), close: vi.fn(), forceClose: vi.fn() }
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket)

    bufferedSocket.forceClose(1013, 'capacity exceeded')

    expect(rawSocket.forceClose).toHaveBeenCalledWith(1013, 'capacity exceeded')
    expect(rawSocket.close).not.toHaveBeenCalled()
  })

  test('closes the raw transport when an immediate realtime send fails', () => {
    const rawSocket = {
      send: vi.fn(() => {
        throw new Error('socket unavailable')
      }),
      close: vi.fn(),
    }
    const onRelease = vi.fn()
    const bufferedSocket = new BufferedRealtimeSocket(rawSocket, onRelease)

    bufferedSocket.send('event')

    expect(rawSocket.close).toHaveBeenCalledWith(1011, 'realtime send failed')
    expect(onRelease).toHaveBeenCalledOnce()
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

  test('keeps client presence online until its final socket unregisters', () => {
    const onClientPresenceChanged = vi.fn()
    const onUserSocketsDrained = vi.fn()
    const broker = new RealtimeBroker<{ type: 'noop' }>({ onClientPresenceChanged, onUserSocketsDrained })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_a', USER_ID, first)
    broker.registerSocket('client_a', USER_ID, second)
    broker.unregisterSocket(first)

    expect(broker.isClientOnline(USER_ID, 'client_a')).toBe(true)
    expect(onClientPresenceChanged).toHaveBeenCalledTimes(1)
    expect(onUserSocketsDrained).not.toHaveBeenCalled()

    broker.unregisterSocket(second)

    expect(broker.isClientOnline(USER_ID, 'client_a')).toBe(false)
    expect(onClientPresenceChanged).toHaveBeenLastCalledWith({
      clientId: 'client_a',
      userId: USER_ID,
      previousOnline: true,
      online: false,
    })
    expect(onUserSocketsDrained).toHaveBeenCalledWith(USER_ID)
    broker.disconnectAll()
  })

  test('isolates user fanout and unregisters a socket whose send fails', () => {
    const onUserSocketsDrained = vi.fn()
    const broker = new RealtimeBroker<{ type: 'feature.changed'; value: string }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained,
    })
    const failedSocket = {
      send: vi.fn(() => {
        throw new Error('socket unavailable')
      }),
      close: vi.fn(),
    }
    const otherUserSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_shared', USER_ID, failedSocket)
    broker.registerSocket('client_shared', OTHER_USER_ID, otherUserSocket)

    broker.broadcastToUser(USER_ID, { type: 'feature.changed', value: 'ok' })

    expect(otherUserSocket.send).not.toHaveBeenCalled()
    expect(broker.hasUserSockets(USER_ID)).toBe(false)
    expect(broker.hasUserSockets(OTHER_USER_ID)).toBe(true)
    expect(onUserSocketsDrained).toHaveBeenCalledWith(USER_ID)
    broker.disconnectAll()
  })

  test('re-registering a socket replaces its previous user and client identity', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged,
      onUserSocketsDrained: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', USER_ID, socket)

    broker.registerSocket('client_b', OTHER_USER_ID, socket)

    expect(broker.isClientOnline(USER_ID, 'client_a')).toBe(false)
    expect(broker.isClientOnline(OTHER_USER_ID, 'client_b')).toBe(true)
    expect(onClientPresenceChanged.mock.calls.map(([event]) => event)).toEqual([
      { clientId: 'client_a', userId: USER_ID, previousOnline: false, online: true },
      { clientId: 'client_a', userId: USER_ID, previousOnline: true, online: false },
      { clientId: 'client_b', userId: OTHER_USER_ID, previousOnline: false, online: true },
    ])
    broker.disconnectAll()
  })

  test('expires a stale socket without taking a healthy socket for the same client offline', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged,
      onUserSocketsDrained: vi.fn(),
      livenessTimeoutReason: 'test liveness timeout',
    })
    const staleSocket = { send: vi.fn(), close: vi.fn() }
    const healthySocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', USER_ID, staleSocket)
    broker.registerSocket('client_a', USER_ID, healthySocket)
    onClientPresenceChanged.mockClear()

    vi.advanceTimersByTime(REALTIME_LIVENESS_PROBE_INTERVAL_MS * 2)
    broker.recordLiveness(healthySocket)
    vi.advanceTimersByTime(REALTIME_LIVENESS_PROBE_INTERVAL_MS * 2)

    expect(staleSocket.close).toHaveBeenCalledWith(1001, 'test liveness timeout')
    expect(healthySocket.close).not.toHaveBeenCalled()
    expect(broker.socketCount()).toBe(1)
    expect(broker.isClientOnline(USER_ID, 'client_a')).toBe(true)
    expect(onClientPresenceChanged).not.toHaveBeenCalled()
    broker.disconnectAll()
  })

  test('disconnectAll gracefully closes transports and clears broker state', () => {
    const broker = new RealtimeBroker<{ type: 'noop' }>({
      onClientPresenceChanged: vi.fn(),
      onUserSocketsDrained: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn(), forceClose: vi.fn() }
    broker.registerSocket('client_a', USER_ID, socket)

    broker.disconnectAll()

    expect(socket.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(socket.forceClose).not.toHaveBeenCalled()
    expect(broker.socketCount()).toBe(0)
    expect(broker.hasUserSockets(USER_ID)).toBe(false)
    expect(broker.isClientOnline(USER_ID, 'client_a')).toBe(false)
  })
})
