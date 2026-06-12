import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { IpcEvent } from '#/shared/api-types.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

describe('renderer ingress', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setRendererBridgeForTests(null)
  })

  test('subscribes to typed native host events through the renderer bridge', async () => {
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
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

    const { subscribeNativeHostEventType } = await import('#/web/renderer-ingress.ts')
    const cb = vi.fn()
    const unsubscribe = subscribeNativeHostEventType('settings-write-error', cb)

    expect(cb).toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    expect(cb).not.toHaveBeenCalledWith({ type: 'terminal-notifications-changed', enabled: true })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })

  test('subscribes to renderer effect intents without forwarding non-intent payloads', async () => {
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
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

    const { subscribeRendererEffectIntentType } = await import('#/web/renderer-ingress.ts')
    const cb = vi.fn()
    const unsubscribe = subscribeRendererEffectIntentType('external-open-enqueued', cb)

    expect(cb).toHaveBeenCalledWith({ type: 'external-open-enqueued' })
    expect(cb).not.toHaveBeenCalledWith({ type: 'settings-write-error', message: 'failed' })
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })
})
