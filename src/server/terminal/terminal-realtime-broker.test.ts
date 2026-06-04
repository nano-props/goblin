import { describe, expect, test, vi } from 'vitest'
import { TerminalRealtimeBroker } from '#/server/terminal/terminal-realtime-broker.ts'

describe('terminal realtime broker', () => {
  test('disconnectAll closes registered sockets and clears connection state', () => {
    const broker = new TerminalRealtimeBroker({
      onAttachmentConnected: vi.fn(),
      onAttachmentDisconnected: vi.fn(),
      onClientDisconnected: vi.fn(),
    })
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }

    broker.registerSocket('client_1', 'attachment_a', first)
    broker.registerSocket('client_1', 'attachment_b', second)
    broker.disconnectAll()

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(broker.hasClientSockets('client_1')).toBe(false)
    expect(broker.attachmentIsConnected('client_1', 'attachment_a')).toBe(false)
    expect(broker.attachmentIsConnected('client_1', 'attachment_b')).toBe(false)
  })
})
