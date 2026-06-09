import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

describe('repo web transport helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
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
        open: vi.fn(() => ({})),
      },
    })
  })

  test('checkout uses embedded server route in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: '' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { checkoutRepositoryBranch } = await import('#/web/repo-client.ts')

    await expect(checkoutRepositoryBranch('/tmp/repo', 'feature/a')).resolves.toEqual({ ok: true, message: '' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/checkout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        }),
      }),
    )
  })

  test('copy-patch helper uses embedded server route in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'diff --git a/file b/file' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { getRepositoryPatch } = await import('#/web/repo-client.ts')

    await expect(getRepositoryPatch('/tmp/repo', '/tmp/repo')).resolves.toEqual({
      ok: true,
      message: 'diff --git a/file b/file',
    })
  })

  test('open remote opens browser with server-provided URL in web host mode', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://example.com/repo/tree/feature/a' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { openRepositoryRemote } = await import('#/web/repo-client.ts')

    await expect(openRepositoryRemote('/tmp/repo', 'feature/a')).resolves.toEqual({ ok: true, message: '' })
    expect(window.open).toHaveBeenCalledWith('https://example.com/repo/tree/feature/a', '_blank', 'noopener,noreferrer')
  })

  test('remote target resolution uses embedded server routes in web host mode', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        target: { id: 'remote:test', displayName: 'repo', alias: 'example', remotePath: '/srv/repo' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
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
          'x-goblin-internal-secret': 'secret',
        }),
      }),
    )
  })
})
