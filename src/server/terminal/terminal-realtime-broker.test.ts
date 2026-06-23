import { describe, expect, test, vi } from 'vitest'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'

const USER_A = 'user_a'
const USER_B = 'user_b'

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears connection state', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_1_b', USER_A, second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasOwnerSockets(USER_A)).toBe(false)
    expect(broker.isClientConnected(USER_A, 'client_a')).toBe(false)
    expect(broker.isClientConnected(USER_A, 'client_b')).toBe(false)
  })

  test('broadcastToOwner fans out to every clientId sharing the same userId', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const electronSocket = { send: vi.fn(), close: vi.fn() }
    const chromeSocket = { send: vi.fn(), close: vi.fn() }
    // Two clientIds (Electron and Chrome on the same host share the
    // same access token → same userId) registered as separate WS
    // sockets.
    broker.registerSocket('client_electron_a', USER_A, electronSocket)
    broker.registerSocket('client_chrome_b', USER_A, chromeSocket)

    broker.broadcastToOwner(USER_A, {
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

  test('broadcastToOwner does not leak across ownerIds', () => {
    // Two different access tokens must never see each other's
    // fanout. Socket storage is owner-keyed; cross-owner messages
    // stay isolated.
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, ownerASocket)
    broker.registerSocket('client_b_a', USER_B, ownerBSocket)

    broker.broadcastToOwner(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(ownerASocket.send).toHaveBeenCalledTimes(1)
    expect(ownerBSocket.send).not.toHaveBeenCalled()
  })

  test('broadcastToOwner isolates owners even when clientId is reused', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_shared_a', USER_A, ownerASocket)
    broker.registerSocket('client_shared_b', USER_B, ownerBSocket)

    broker.broadcastToOwner(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(ownerASocket.send).toHaveBeenCalledTimes(1)
    expect(ownerBSocket.send).not.toHaveBeenCalled()
    expect(broker.isClientConnected(USER_A, 'client_shared_a')).toBe(true)
    expect(broker.isClientConnected(USER_B, 'client_shared_b')).toBe(true)
    expect(broker.isClientConnected(USER_A, 'client_shared_b')).toBe(false)
  })

  test('unregisterSocket removes the socket from owner fanout', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, socket)
    broker.unregisterSocket(socket)

    // After the last socket for `client_1` is gone, a
    // `broadcastToOwner` for USER_A must not attempt to send to
    // the now-empty owner set. We assert the side effect by
    // checking the WS was not closed and the broadcast is a no-op.
    expect(socket.close).not.toHaveBeenCalled()
    broker.broadcastToOwner(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('registerSocket replaces stale metadata when the same socket is registered again', () => {
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a_a', USER_A, socket)
    broker.registerSocket('client_b_b', USER_B, socket)

    expect(broker.isClientConnected(USER_A, 'client_a_a')).toBe(false)
    expect(broker.isClientConnected(USER_B, 'client_b_b')).toBe(true)

    broker.broadcastToOwner(USER_A, {
      type: 'output',
      event: { ptySessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    broker.broadcastToOwner(USER_B, {
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
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, socket)
    expect(onClientConnected).toHaveBeenCalledWith('client_1_a', USER_A)
  })

  test('onOwnerDisconnected waits for the last socket under that owner', () => {
    const onOwnerDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onClientConnected: vi.fn(),
      onClientDisconnected: vi.fn(),
      onOwnerDisconnected,
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1_a', USER_A, first)
    broker.registerSocket('client_2_b', USER_A, second)

    broker.unregisterSocket(first)
    expect(onOwnerDisconnected).not.toHaveBeenCalled()

    broker.unregisterSocket(second)
    expect(onOwnerDisconnected).toHaveBeenCalledWith(USER_A)
  })
})
