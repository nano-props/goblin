import { stubBrowserGlobal } from '#/web/test-utils/browser-globals.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('client server config', () => {
  beforeEach(() => {
    vi.resetModules()
    stubBrowserGlobal('window', undefined)
    stubBrowserGlobal('document', undefined)
  })

  test('falls back to same-origin server when bootstrap has no handoff', async () => {
    stubBrowserGlobal('window', {
      __GOBLIN_BOOTSTRAP__: {
        initialServer: null,
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        protocol: 'http:',
        search: '',
      },
    })

    const { resolveClientServerConfig } = await import('#/web/lib/server-config.ts')

    expect(resolveClientServerConfig()).toEqual({
      url: 'http://127.0.0.1:32100',
      accessToken: '',
    })
  })

  test('prefers bootstrap server handoff when present', async () => {
    stubBrowserGlobal('window', {
      __GOBLIN_BOOTSTRAP__: {
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      },
      location: {
        href: 'http://127.0.0.1:5173/',
        origin: 'http://127.0.0.1:5173',
        protocol: 'http:',
        search: '',
      },
    })

    const { resolveClientServerConfig } = await import('#/web/lib/server-config.ts')

    expect(resolveClientServerConfig()).toEqual({
      url: 'http://127.0.0.1:32100/',
      accessToken: 'secret',
    })
  })
})
