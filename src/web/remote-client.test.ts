import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

describe('remote client web helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    setRendererBridgeForTests(null)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          homeDir: '',
          initialI18n: null,
          initialSettings: null,
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
      },
    })
  })

  test('loads ssh hosts from embedded server in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hosts: [{ alias: 'prod' }], hasInclude: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRemoteSshHosts } = await import('#/web/app-data-client.ts')

    await expect(getRemoteSshHosts()).resolves.toEqual({ hosts: [{ alias: 'prod' }], hasInclude: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/ssh-hosts',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
      }),
    )
  })

  test('tests remote repository through embedded server in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        target: {
          id: 'ssh-config://prod/srv/repo',
          alias: 'prod',
          host: 'example.com',
          user: 'alice',
          port: 22,
          remotePath: '/srv/repo',
          displayName: 'prod:repo',
        },
        stages: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { testRemoteRepositoryConnection } = await import('#/web/app-data-client.ts')

    await expect(
      testRemoteRepositoryConnection({
        id: 'ssh-config://prod/srv/repo',
        alias: 'prod',
        host: 'example.com',
        user: 'alice',
        port: 22,
        remotePath: '/srv/repo',
        displayName: 'prod:repo',
      }),
    ).resolves.toMatchObject({ ok: true })
  })
})
