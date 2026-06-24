import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  HEARTBEAT_DEADLINE_MS,
  HEARTBEAT_INTERVAL_MS,
  TerminalRealtimeBroker,
} from '#/server/terminal/terminal-realtime-broker.ts'

const USER_A = 'user_a'
const USER_B = 'user_b'

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears connection state', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_1_b', USER_A, second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasUserSockets(USER_A)).toBe(false)
    expect(broker.isClientConnected(USER_A, 'client_a')).toBe(false)
    expect(broker.isClientConnected(USER_A, 'client_b')).toBe(false)
  })

  test('broadcastToUser fans out to every clientId sharing the same userId', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const electronSocket = { send: vi.fn(), close: vi.fn() }
    const chromeSocket = { send: vi.fn(), close: vi.fn() }
    // Two clientIds (Electron and Chrome on the same host share the
    // same access token → same userId) registered as separate WS
    // sockets.
    broker.registerSocket('client_electron_a', USER_A, electronSocket)
    broker.registerSocket('client_chrome_b', USER_A, chromeSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'hi', seq: 1, processName: 'zsh' },
    })

    // Both sockets receive the same payload — that is the
    // cross-browser identity fix: Chrome sees the live output
    // produced by the Electron-attached PTY without an attach
    // roundtrip.
    expect(electronSocket.send).toHaveBeenCalledTimes(1)
    expect(chromeSocket.send).toHaveBeenCalledTimes(1)
    const electronPayload = String(electronSocket.send.mock.calls[0]?.[0])
    const chromePayload = String(chromeSocket.send.mock.calls[0]?.[0])
    expect(electronPayload).toBe(chromePayload)
    expect(JSON.parse(electronPayload)).toMatchObject({
      type: 'output',
      event: { data: 'hi', seq: 1 },
    })
  })

  test('broadcastToUser does not leak across userIds', () => {
    // Two different access tokens must never see each other's
    // fanout. Socket storage is user-keyed; cross-user messages
    // stay isolated.
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, userASocket)
    broker.registerSocket('client_b_a', USER_B, userBSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(userASocket.send).toHaveBeenCalledTimes(1)
    expect(userBSocket.send).not.toHaveBeenCalled()
  })

  test('broadcastToUser isolates users even when clientId is reused', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_shared_a', USER_A, userASocket)
    broker.registerSocket('client_shared_b', USER_B, userBSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(userASocket.send).toHaveBeenCalledTimes(1)
    expect(userBSocket.send).not.toHaveBeenCalled()
    expect(broker.isClientConnected(USER_A, 'client_shared_a')).toBe(true)
    expect(broker.isClientConnected(USER_B, 'client_shared_b')).toBe(true)
    expect(broker.isClientConnected(USER_A, 'client_shared_b')).toBe(false)
  })

  test('unregisterSocket removes the socket from user fanout', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, socket)
    broker.unregisterSocket(socket)

    // After the last socket for `client_1` is gone, a
    // `broadcastToUser` for USER_A must not attempt to send to
    // the now-empty user set. We assert the side effect by
    // checking the WS was not closed and the broadcast is a no-op.
    expect(socket.close).not.toHaveBeenCalled()
    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('registerSocket replaces stale metadata when the same socket is registered again', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, socket)
    broker.registerSocket('client_b_b', USER_B, socket)

    expect(broker.isClientConnected(USER_A, 'client_a_a')).toBe(false)
    expect(broker.isClientConnected(USER_B, 'client_b_b')).toBe(true)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    broker.broadcastToUser(USER_B, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'b', seq: 2, processName: 'zsh' },
    })

    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
      event: { data: 'b', seq: 2 },
    })
  })

  test('onClientConnected receives the userId from registerSocket', () => {
    const onClientConnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected,
      onClientDisconnected: vi.fn(),
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, socket)
    expect(onClientConnected).toHaveBeenCalledWith('client_1_a', USER_A)
  })

  test('onUserDisconnected waits for the last socket under that user', () => {
    const onUserDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onUserDisconnected,
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_2_b', USER_A, second)

    broker.unregisterSocket(first)
    expect(onUserDisconnected).not.toHaveBeenCalled()

    broker.unregisterSocket(second)
    expect(onUserDisconnected).toHaveBeenCalledWith(USER_A)
  })
})

describe('terminal realtime broker heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Pin the wall clock so `recordHeartbeat`'s `at` and the
    // deadline scan's `Date.now()` agree. Without this, a heartbeat
    // recorded at the boundary between two real `Date.now()` ticks
    // could land on the wrong side of the deadline assertion.
    vi.setSystemTime(new Date('2026-06-24T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('fired deadline fires synthetic onClientDisconnected for silent (userId, clientId)', () => {
    const onClientDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected,
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)

    // Advance past the deadline without a heartbeat in between.
    vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS)

    expect(onClientDisconnected).toHaveBeenCalledWith('client_a_1', USER_A)
    broker.disconnectAll()
  })

  test('recordHeartbeat resets the deadline so a chatty client is never disconnected', () => {
    const onClientDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected,
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)

    // 3 intervals of heartbeats keep the deadline at bay.
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      broker.recordHeartbeat(USER_A, 'client_a_1', Date.now())
    }
    // Total wall clock: 90 s; without the recordHeartbeat
    // calls that would already be past the 90 s deadline.
    expect(onClientDisconnected).not.toHaveBeenCalled()

    broker.disconnectAll()
  })

  test('recordHeartbeat for an unknown (userId, clientId) is a no-op', () => {
    const onClientDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected,
      onUserDisconnected: vi.fn(),
    })
    // No registerSocket — the (userId, clientId) is unknown.
    broker.recordHeartbeat(USER_A, 'never_connected', Date.now())
    // Advance past the deadline: nothing should fire because the
    // broker never had any sockets for this pair.
    vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS)
    expect(onClientDisconnected).not.toHaveBeenCalled()
    broker.disconnectAll()
  })

  test('unregisterSocket clears the heartbeat clock for the closing (userId, clientId)', () => {
    const onClientDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected,
      onUserDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)
    broker.unregisterSocket(socket)
    // The unregister path itself fires `onClientDisconnected` exactly
    // once. Clear the mock so the post-deadline assertion only
    // observes the synthetic deadline-driven call (if any).
    onClientDisconnected.mockClear()

    // Past the deadline — the synthetic disconnect path should NOT
    // fire because the (userId, clientId) was already fully
    // unregistered (no live sockets remain).
    vi.advanceTimersByTime(HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS)
    expect(onClientDisconnected).not.toHaveBeenCalled()

    broker.disconnectAll()
  })
})
