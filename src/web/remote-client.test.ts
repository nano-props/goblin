import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('remote client web helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    setClientBridgeForTests(null)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ hosts: [{ alias: 'prod' }], hasInclude: true }),
    }))
    const { getRemoteSshHosts } = await import('#/web/remote-client.ts')

    await expect(getRemoteSshHosts()).resolves.toEqual({ hosts: [{ alias: 'prod' }], hasInclude: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/ssh-hosts',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
  })

  test('tests remote repository through embedded server in web host mode', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        target: {
          id: 'goblin+ssh://prod/srv/repo',
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
    const { testRemoteRepoConnection } = await import('#/web/remote-client.ts')

    await expect(
      testRemoteRepoConnection({
        id: workspaceIdForTest('goblin+ssh://prod/srv/repo'),
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
