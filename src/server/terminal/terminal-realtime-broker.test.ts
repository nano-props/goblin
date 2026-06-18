import { describe, expect, test, vi } from 'vitest'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'

const OWNER_A = 'owner_a'
const OWNER_B = 'owner_b'

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears connection state', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1', 'attachment_a', OWNER_A, first)
    broker.registerSocket('client_1', 'attachment_b', OWNER_A, second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasOwnerSockets(OWNER_A)).toBe(false)
    expect(broker.isAttachmentConnected(OWNER_A, 'attachment_a')).toBe(false)
    expect(broker.isAttachmentConnected(OWNER_A, 'attachment_b')).toBe(false)
  })

  test('broadcastToOwner fans out to every clientId sharing the same ownerId', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const electronSocket = { send: vi.fn(), close: vi.fn() }
    const chromeSocket = { send: vi.fn(), close: vi.fn() }
    // Two clientIds (Electron and Chrome on the same host share the
    // same access token → same ownerId) registered as separate WS
    // sockets.
    broker.registerSocket('client_electron', 'attachment_a', OWNER_A, electronSocket)
    broker.registerSocket('client_chrome', 'attachment_b', OWNER_A, chromeSocket)

    broker.broadcastToOwner(OWNER_A, {
      type: 'output',
      event: { sessionId: 's_1', data: 'hi', seq: 1, processName: 'zsh' },
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
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', 'attachment_a', OWNER_A, ownerASocket)
    broker.registerSocket('client_b', 'attachment_a', OWNER_B, ownerBSocket)

    broker.broadcastToOwner(OWNER_A, {
      type: 'output',
      event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(ownerASocket.send).toHaveBeenCalledTimes(1)
    expect(ownerBSocket.send).not.toHaveBeenCalled()
  })

  test('broadcastToOwner isolates owners even when clientId is reused', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_shared', 'attachment_a', OWNER_A, ownerASocket)
    broker.registerSocket('client_shared', 'attachment_b', OWNER_B, ownerBSocket)

    broker.broadcastToOwner(OWNER_A, {
      type: 'output',
      event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })

    expect(ownerASocket.send).toHaveBeenCalledTimes(1)
    expect(ownerBSocket.send).not.toHaveBeenCalled()
    expect(broker.isAttachmentConnected(OWNER_A, 'attachment_a')).toBe(true)
    expect(broker.isAttachmentConnected(OWNER_B, 'attachment_b')).toBe(true)
    expect(broker.isAttachmentConnected(OWNER_A, 'attachment_b')).toBe(false)
  })

  test('unregisterSocket removes the socket from owner fanout', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1', 'attachment_a', OWNER_A, socket)
    broker.unregisterSocket(socket)

    // After the last socket for `client_1` is gone, a
    // `broadcastToOwner` for OWNER_A must not attempt to send to
    // the now-empty owner set. We assert the side effect by
    // checking the WS was not closed and the broadcast is a no-op.
    expect(socket.close).not.toHaveBeenCalled()
    broker.broadcastToOwner(OWNER_A, {
      type: 'output',
      event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('registerSocket replaces stale metadata when the same socket is registered again', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', 'attachment_a', OWNER_A, socket)
    broker.registerSocket('client_b', 'attachment_b', OWNER_B, socket)

    expect(broker.isAttachmentConnected(OWNER_A, 'attachment_a')).toBe(false)
    expect(broker.isAttachmentConnected(OWNER_B, 'attachment_b')).toBe(true)

    broker.broadcastToOwner(OWNER_A, {
      type: 'output',
      event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' },
    })
    broker.broadcastToOwner(OWNER_B, {
      type: 'output',
      event: { sessionId: 's_1', data: 'b', seq: 2, processName: 'zsh' },
    })

    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
      event: { data: 'b', seq: 2 },
    })
  })

  test('onAttachmentConnected receives the ownerId from registerSocket', () => {
    const onAttachmentConnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected,
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1', 'attachment_a', OWNER_A, socket)
    expect(onAttachmentConnected).toHaveBeenCalledWith('client_1', 'attachment_a', OWNER_A)
  })

  test('onOwnerDisconnected waits for the last socket under that owner', () => {
    const onOwnerDisconnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onOwnerDisconnected,
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1', 'attachment_a', OWNER_A, first)
    broker.registerSocket('client_2', 'attachment_b', OWNER_A, second)

    broker.unregisterSocket(first)
    expect(onOwnerDisconnected).not.toHaveBeenCalled()

    broker.unregisterSocket(second)
    expect(onOwnerDisconnected).toHaveBeenCalledWith(OWNER_A)
  })
})
