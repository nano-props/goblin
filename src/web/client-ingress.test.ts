import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { IpcEvent } from '#/shared/api-types.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'

describe('client ingress', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  test('subscribes to typed native host events through the client bridge', async () => {
    const off = vi.fn()
    const onEvent = vi.fn((cb: (event: IpcEvent) => void) => {
      cb({ type: 'settings-write-error', message: 'failed' })
      cb({ type: 'terminal-notifications-changed', enabled: true })
      return off
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: CLIENT_BRIDGE_VERSION,
            capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
          },
          invokeIpc: vi.fn(),
          abortIpc: vi.fn(async () => false),
          onEvent,
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
      },
    })

    const { subscribeNativeHostEventType } = await import('#/web/client-ingress.ts')
    const cb = vi.fn()
    const unsubscribe = subscribeNativeHostEventType('settings-write-error', cb)

    expect(cb).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(cb).not.toHaveBeenCalledWith({ type: 'terminal-notifications-changed', enabled: true })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })

  test('subscribes to client effect intents without forwarding non-intent payloads', async () => {
    const off = vi.fn()
    const onIntent = vi.fn((cb: (event: unknown) => void) => {
      cb({ type: 'external-open-enqueued' })
      cb({ type: 'settings-write-error', message: 'failed' })
      return off
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: CLIENT_BRIDGE_VERSION,
            capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
          },
          invokeIpc: vi.fn(),
          abortIpc: vi.fn(async () => false),
          onEvent: vi.fn(() => () => {}),
          onIntent,
          pathForFile: () => '',
        },
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
    expect(cb).not.toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })
})
