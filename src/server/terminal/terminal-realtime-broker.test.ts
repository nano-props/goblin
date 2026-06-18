import { describe, expect, test, vi } from 'vitest'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'

const OWNER_A = 'owner_a'
const OWNER_B = 'owner_b'

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears connection state', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1', 'attachment_a', OWNER_A, first)
    broker.registerSocket('client_1', 'attachment_b', OWNER_A, second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasClientSockets('client_1')).toBe(false)
    expect(broker.attachmentIsConnected('client_1', 'attachment_a')).toBe(false)
    expect(broker.attachmentIsConnected('client_1', 'attachment_b')).toBe(false)
  })

  test('broadcastOwner fans out to every clientId sharing the same ownerId', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const electronSocket = { send: vi.fn(), close: vi.fn() }
    const chromeSocket = { send: vi.fn(), close: vi.fn() }
    // Two clientIds (Electron and Chrome on the same host share the
    // same access token → same ownerId) registered as separate WS
    // sockets.
    broker.registerSocket('client_electron', 'attachment_a', OWNER_A, electronSocket)
    broker.registerSocket('client_chrome', 'attachment_b', OWNER_A, chromeSocket)

    broker.broadcastOwner(OWNER_A, { type: 'output', event: { sessionId: 's_1', data: 'hi', seq: 1, processName: 'zsh' } })

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

  test('broadcastOwner does not leak across ownerIds', () => {
    // Two different access tokens must never see each other's
    // fanout. The reverse index is per-ownerId; cross-owner
    // messages stay isolated.
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const ownerASocket = { send: vi.fn(), close: vi.fn() }
    const ownerBSocket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_a', 'attachment_a', OWNER_A, ownerASocket)
    broker.registerSocket('client_b', 'attachment_a', OWNER_B, ownerBSocket)

    broker.broadcastOwner(OWNER_A, { type: 'output', event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' } })

    expect(ownerASocket.send).toHaveBeenCalledTimes(1)
    expect(ownerBSocket.send).not.toHaveBeenCalled()
  })

  test('unregisterSocket drops the clientId from the ownerId reverse index', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1', 'attachment_a', OWNER_A, socket)
    broker.unregisterSocket('client_1', 'attachment_a', OWNER_A, socket)

    // After the last socket for `client_1` is gone, a
    // `broadcastOwner` for OWNER_A must not attempt to send to
    // the now-empty clientId set. We assert the side effect by
    // checking the WS was closed and the broadcast is a no-op.
    expect(socket.close).not.toHaveBeenCalled()
    broker.broadcastOwner(OWNER_A, { type: 'output', event: { sessionId: 's_1', data: 'a', seq: 1, processName: 'zsh' } })
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('onAttachmentConnected receives the ownerId from registerSocket', () => {
    const onAttachmentConnected = vi.fn()
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected,
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const socket = { send: vi.fn(), close: vi.fn() }
    broker.registerSocket('client_1', 'attachment_a', OWNER_A, socket)
    expect(onAttachmentConnected).toHaveBeenCalledWith('client_1', 'attachment_a', OWNER_A)
  })
})
