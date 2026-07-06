import { beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

describe('repo web transport helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
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
        open: vi.fn(() => ({})),
      },
    })
  })

  test('copy-patch helper uses embedded server route in web host mode', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'diff --git a/file b/file' }),
    }))
    const { getRepoPatch } = await import('#/web/repo-client.ts')

    await expect(getRepoPatch('/tmp/repo', '/tmp/repo')).resolves.toEqual({
      ok: true,
      message: 'diff --git a/file b/file',
    })
  })

  test('open repo URL opens browser with server-provided URL in web host mode', async () => {
    mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://example.com/repo/tree/feature/a' }),
    }))
    const { openRepoUrl } = await import('#/web/repo-client.ts')

    await expect(openRepoUrl('/tmp/repo', { type: 'branch', branch: 'feature/a' })).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(window.open).toHaveBeenCalledWith('https://example.com/repo/tree/feature/a', '_blank', 'noopener,noreferrer')
  })

  test('remote target resolution uses embedded server routes in web host mode', async () => {
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
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        target: { id: 'remote:test', displayName: 'repo', alias: 'example', remotePath: '/srv/repo' },
      }),
    }))
    const { resolveRemoteRepositoryTarget } = await import('#/web/remote-client.ts')

    await expect(
      resolveRemoteRepositoryTarget({
        alias: 'example',
        remotePath: '/srv/repo',
      }),
    ).resolves.toMatchObject({ id: 'remote:test', alias: 'example' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/remote/resolve-target',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-access-token': 'secret',
        }),
      }),
    )
  })
})
