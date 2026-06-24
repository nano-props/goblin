import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  disconnectAllRendererIntentSockets,
  MAX_RENDERER_INTENT_SOCKETS,
  publishRendererIntent,
  registerRendererIntentSocket,
  RendererIntentSocketLimitError,
  unregisterRendererIntentSocket,
} from '#/server/modules/client-intent-broker.ts'

describe('renderer intent broker', () => {
  beforeEach(() => {
    disconnectAllRendererIntentSockets()
  })

  test('returns false when no subscriber is attached', () => {
    expect(
      publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' }),
    ).toBe(false)
  })

  test('broadcasts the enveloped intent to every subscriber and returns true', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerRendererIntentSocket(first)
    registerRendererIntentSocket(second)

    const ok = publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' })
    expect(ok).toBe(true)

    const expected = JSON.stringify({
      type: 'renderer-effect-intent',
      intent: { type: 'show-workspace-pane-view-requested', tab: 'changes' },
    })
    expect(first.send).toHaveBeenCalledWith(expected)
    expect(second.send).toHaveBeenCalledWith(expected)
  })

  test('disconnects every subscriber during shutdown', () => {
    const first = { send: vi.fn(), close: vi.fn() }
    const second = { send: vi.fn(), close: vi.fn() }
    registerRendererIntentSocket(first)
    registerRendererIntentSocket(second)

    disconnectAllRendererIntentSockets()
    publishRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' })

    expect(first.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(second.close).toHaveBeenCalledWith(1001, 'server shutting down')
    expect(first.send).not.toHaveBeenCalled()
    expect(second.send).not.toHaveBeenCalled()
  })

  test('rejects the (N+1)th subscriber to prevent socket floods', () => {
    for (let i = 0; i < MAX_RENDERER_INTENT_SOCKETS; i += 1) {
      registerRendererIntentSocket({ send: vi.fn(), close: vi.fn() })
    }
    const overflow = { send: vi.fn(), close: vi.fn() }
    expect(() => registerRendererIntentSocket(overflow)).toThrow(RendererIntentSocketLimitError)
  })

  test('frees a slot when a subscriber disconnects', () => {
    const sockets = Array.from({ length: MAX_RENDERER_INTENT_SOCKETS }, () => ({
      send: vi.fn(),
      close: vi.fn(),
    }))
    for (const s of sockets) registerRendererIntentSocket(s)
    unregisterRendererIntentSocket(sockets[0]!)
    expect(() => registerRendererIntentSocket({ send: vi.fn(), close: vi.fn() })).not.toThrow()
  })
})
