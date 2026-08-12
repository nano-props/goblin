import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

describe('client ingress', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  test('subscribes to client effect intents without forwarding non-intent payloads', async () => {
    const off = vi.fn()
    const onIntent = vi.fn((cb: (event: ClientEffectIntent) => void) => {
      cb({ type: 'external-open-enqueued' })
      Reflect.apply(cb, undefined, [{ type: 'obsolete-native-event' }])
      return off
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblinNative: currentNativeBridge({ onIntent }),
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
      },
    })

    const { subscribeClientEffectIntentType } = await import('#/web/client-ingress.ts')
    const cb = vi.fn()
    const unsubscribe = subscribeClientEffectIntentType('external-open-enqueued', cb)

    expect(cb).toHaveBeenCalledWith({ type: 'external-open-enqueued' })
    expect(cb).not.toHaveBeenCalledWith({ type: 'obsolete-native-event' })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })
})
