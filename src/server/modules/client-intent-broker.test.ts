import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllClientIntentSockets,
  MAX_RENDERER_INTENT_SOCKETS,
  publishRendererIntent,
  registerClientIntentSocket,
  ClientIntentSocketLimitError,
  unregisterClientIntentSocket,
} from '#/server/modules/client-intent-broker.ts'

describe('client intent broker', () => {
  beforeEach(() => {
    disconnectAllClientIntentSockets()
  })

  test('returns false when no subscriber is attached', () => {
    expect(
      publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' }),
    ).toBe(false)
  })

  test('broadcasts the enveloped intent to every subscriber and returns true', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(first)
    registerClientIntentSocket(second)

    const ok = publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' })
    expect(ok).toBe(true)

    const expected = JSON.stringify({
      type: 'client-effect-intent',
      intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
    })
    expect(first.send).toHaveBeenCalledWith(expected)
    expect(second.send).toHaveBeenCalledWith(expected)
  })

  test('disconnects every subscriber during shutdown', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerClientIntentSocket(first)
    registerClientIntentSocket(second)

    disconnectAllClientIntentSockets()
    publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' })

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(first.send).not.toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('rejects the (N+1)th subscriber to prevent socket floods', () => {
    for (let i = 0; i < MAX_RENDERER_INTENT_SOCKETS; i += 1) {
      registerClientIntentSocket({ send: vi.fn(), close: vi.fn() })
    }
    const overflow = { send: vi.fn(), close: vi.fn() }
    expect(() => registerClientIntentSocket(overflow)).toThrow(ClientIntentSocketLimitError)
  })

  test('frees a slot when a subscriber disconnects', () => {
    const sockets = Array.from({ length: MAX_RENDERER_INTENT_SOCKETS }, () => ({
      send: vi.fn(),
      close: vi.fn(),
    }))
    for (const s of sockets) registerClientIntentSocket(s)
    unregisterClientIntentSocket(sockets[0]!)
    expect(() => registerClientIntentSocket({ send: vi.fn(), close: vi.fn() })).not.toThrow()
  })
})
