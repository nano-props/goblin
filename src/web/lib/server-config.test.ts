import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

describe('client server config', () => {
  beforeEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
  })

  test('falls back to same-origin server when bootstrap has no handoff', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
          initialServer: null,
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          protocol: 'http:',
          search: '',
        },
      },
    })

    const { resolveClientServerConfig } = await import('#/web/lib/server-config.ts')

    expect(resolveClientServerConfig()).toEqual({
      url: 'http://127.0.0.1:32100',
      accessToken: '',
    })
  })

  test('prefers bootstrap server handoff when present', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        },
        location: {
          href: 'http://127.0.0.1:5173/',
          origin: 'http://127.0.0.1:5173',
          protocol: 'http:',
          search: '',
        },
      },
    })

    const { resolveClientServerConfig } = await import('#/web/lib/server-config.ts')

    expect(resolveClientServerConfig()).toEqual({
      url: 'http://127.0.0.1:32100/',
      accessToken: 'secret',
    })
  })
})
