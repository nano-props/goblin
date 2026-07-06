import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  HEARTBEAT_DEADLINE_MS,
  HEARTBEAT_INTERVAL_MS,
  TerminalRealtimeBroker,
  type TerminalClientPresenceChange,
} from '#/server/terminal/terminal-realtime-broker.ts'
import { BufferedTerminalSocket } from '#/server/terminal/buffered-terminal-socket.ts'

const USER_A = 'user_a'
const USER_B = 'user_b'
const TEST_NOW = new Date('2026-06-24T00:00:00Z')
const HEARTBEAT_SILENCE_MS = HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS

function createBroker(
  options: {
    onClientPresenceChanged?: (event: TerminalClientPresenceChange) => void
    onUserSocketsDrained?: (userId: string) => void
  } = {},
): TerminalRealtimeBroker {
  return new TerminalRealtimeBroker({
    onClientPresenceChanged: options.onClientPresenceChanged ?? vi.fn(),
    onUserSocketsDrained: options.onUserSocketsDrained ?? vi.fn(),
  })
}

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears presence state', () => {
    const broker = createBroker()
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_1_b', USER_A, second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasUserSockets(USER_A)).toBe(false)
    expect(broker.isClientOnline(USER_A, 'client_1_a')).toBe(false)
    expect(broker.isClientOnline(USER_A, 'client_1_b')).toBe(false)
  })

  test('disconnectAll force-closes paused buffered sockets', () => {
    const broker = createBroker()
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedTerminalSocket(rawSocket)
    bufferedSocket.pause()
    broker.registerSocket('client_1_a', USER_A, bufferedSocket)

    broker.disconnectAll()

    expect(rawSocket.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasUserSockets(USER_A)).toBe(false)
  })

  test('broadcastToUser fans out to every clientId sharing the same userId', () => {
    const broker = createBroker()
    const electronSocket = { send: vi.fn(), close: vi.fn() }
    const chromeSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_electron_a', USER_A, electronSocket)
    broker.registerSocket('client_chrome_b', USER_A, chromeSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: {
        terminalRuntimeSessionId: 's_1',
        terminalSessionId: 'terminal_1',
        data: 'hi',
        outputEra: 0,
        seq: 1,
        processName: 'zsh',
      },
    })

    expect(electronSocket.send).toHaveBeenCalledTimes(1)
    expect(chromeSocket.send).toHaveBeenCalledTimes(1)
    const payload = String(electronSocket.send.mock.calls[0]?.[0])
    expect(String(chromeSocket.send.mock.calls[0]?.[0])).toBe(payload)
    expect(JSON.parse(payload)).toMatchObject({
      type: 'output',
      event: {
        terminalRuntimeSessionId: 's_1',
        terminalSessionId: 'terminal_1',
        data: 'hi',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      },
    })
  })

  test('broadcastToUser does not leak across userIds', () => {
    const broker = createBroker()
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, userASocket)
    broker.registerSocket('client_b_a', USER_B, userBSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: {
        terminalRuntimeSessionId: 's_1',
        terminalSessionId: 'terminal_1',
        data: 'a',
        outputEra: 0,
        seq: 1,
        processName: 'zsh',
      },
    })

    expect(userASocket.send).toHaveBeenCalledTimes(1)
    expect(userBSocket.send).not.toHaveBeenCalled()
  })

  test('broadcastToUser isolates users even when clientId is reused', () => {
    const broker = createBroker()
    const userASocket = { send: vi.fn(), close: vi.fn() }
    const userBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_shared', USER_A, userASocket)
    broker.registerSocket('client_shared', USER_B, userBSocket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: {
        terminalRuntimeSessionId: 's_1',
        terminalSessionId: 'terminal_1',
        data: 'a',
        outputEra: 0,
        seq: 1,
        processName: 'zsh',
      },
    })

    expect(userASocket.send).toHaveBeenCalledTimes(1)
    expect(userBSocket.send).not.toHaveBeenCalled()
    expect(broker.isClientOnline(USER_A, 'client_shared')).toBe(true)
    expect(broker.isClientOnline(USER_B, 'client_shared')).toBe(true)
  })

  test('unregisterSocket removes the socket from user fanout', () => {
    const broker = createBroker()
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, socket)
    broker.unregisterSocket(socket)

    broker.broadcastToUser(USER_A, {
      type: 'output',
      event: {
        terminalRuntimeSessionId: 's_1',
        terminalSessionId: 'terminal_1',
        data: 'a',
        outputEra: 0,
        seq: 1,
        processName: 'zsh',
      },
    })
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('registerSocket replaces stale metadata when the same socket is registered again', () => {
    const broker = createBroker()
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, socket)
    broker.registerSocket('client_b_b', USER_B, socket)

    expect(broker.isClientOnline(USER_A, 'client_a_a')).toBe(false)
    expect(broker.isClientOnline(USER_B, 'client_b_b')).toBe(true)
  })

  test('multiple sockets for the same clientId share one presence record', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_1_a', USER_A, second)
    broker.unregisterSocket(first)

    expect(broker.isClientOnline(USER_A, 'client_1_a')).toBe(true)
    expect(onClientPresenceChanged).toHaveBeenCalledTimes(1)

    broker.unregisterSocket(second)

    expect(broker.isClientOnline(USER_A, 'client_1_a')).toBe(false)
    expect(onClientPresenceChanged).toHaveBeenNthCalledWith(2, {
      clientId: 'client_1_a',
      userId: USER_A,
      previousOnline: true,
      online: false,
    })
  })

  test('register and unregister emit presence transitions', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const socket = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1_a', USER_A, socket)
    broker.unregisterSocket(socket)

    expect(onClientPresenceChanged).toHaveBeenNthCalledWith(1, {
      clientId: 'client_1_a',
      userId: USER_A,
      previousOnline: false,
      online: true,
    })
    expect(onClientPresenceChanged).toHaveBeenNthCalledWith(2, {
      clientId: 'client_1_a',
      userId: USER_A,
      previousOnline: true,
      online: false,
    })
  })

  test('onUserSocketsDrained waits for the last socket under that user', () => {
    const onUserSocketsDrained = vi.fn()
    const broker = createBroker({ onUserSocketsDrained })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_2_b', USER_A, second)

    broker.unregisterSocket(first)
    expect(onUserSocketsDrained).not.toHaveBeenCalled()

    broker.unregisterSocket(second)
    expect(onUserSocketsDrained).toHaveBeenCalledWith(USER_A)
  })
})

describe('terminal realtime broker heartbeat presence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TEST_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('heartbeat deadline closes and unregisters a silent client socket', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)

    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)

    expect(socket.close).toHaveBeenCalledWith(1001, 'terminal heartbeat timeout')
    expect(broker.hasUserSockets(USER_A)).toBe(false)
    expect(broker.isClientOnline(USER_A, 'client_a_1')).toBe(false)
    expect(onClientPresenceChanged).toHaveBeenLastCalledWith({
      clientId: 'client_a_1',
      userId: USER_A,
      previousOnline: true,
      online: false,
    })
    broker.disconnectAll()
  })

  test('registering after heartbeat eviction recovers presence for the same clientId', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const staleSocket = { send: vi.fn(), close: vi.fn() }
    const freshSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, staleSocket)
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
    onClientPresenceChanged.mockClear()

    broker.registerSocket('client_a_1', USER_A, freshSocket)

    expect(broker.isClientOnline(USER_A, 'client_a_1')).toBe(true)
    expect(onClientPresenceChanged).toHaveBeenCalledWith({
      clientId: 'client_a_1',
      userId: USER_A,
      previousOnline: false,
      online: true,
    })
    broker.disconnectAll()
  })

  test('heartbeat deadline force-closes a paused buffered socket', () => {
    const broker = createBroker()
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const bufferedSocket = new BufferedTerminalSocket(rawSocket)
    bufferedSocket.pause()
    broker.registerSocket('client_a_1', USER_A, bufferedSocket)

    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)

    expect(rawSocket.close).toHaveBeenCalledWith(1001, 'terminal heartbeat timeout')
    expect(broker.hasUserSockets(USER_A)).toBe(false)
    broker.disconnectAll()
  })

  test('recordHeartbeat resets the deadline so a chatty client stays online', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)
    onClientPresenceChanged.mockClear()

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS)
      broker.recordHeartbeat(USER_A, 'client_a_1')
    }

    expect(broker.isClientOnline(USER_A, 'client_a_1')).toBe(true)
    expect(onClientPresenceChanged).not.toHaveBeenCalled()
    broker.disconnectAll()
  })

  test('recordHeartbeat for an unknown client is a no-op', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    broker.recordHeartbeat(USER_A, 'never_online')
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
    expect(onClientPresenceChanged).not.toHaveBeenCalled()
    broker.disconnectAll()
  })

  test('unregisterSocket after heartbeat timeout does not emit duplicate offline presence', () => {
    const onClientPresenceChanged = vi.fn()
    const broker = createBroker({ onClientPresenceChanged })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_1', USER_A, socket)
    vi.advanceTimersByTime(HEARTBEAT_SILENCE_MS)
    onClientPresenceChanged.mockClear()

    broker.unregisterSocket(socket)

    expect(onClientPresenceChanged).not.toHaveBeenCalled()
    broker.disconnectAll()
  })
})
