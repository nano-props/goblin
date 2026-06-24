import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

function webBootstrap(overrides: Partial<ClientBootstrapSnapshot> = {}): ClientBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
    initialServer: null,
    ...overrides,
  }
}

function electronBootstrap(overrides: Partial<ClientBootstrapSnapshot> = {}): ClientBootstrapSnapshot {
  return {
    runtime: {
      kind: 'electron',
      bridgeVersion: CLIENT_BRIDGE_VERSION,
      capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
    },
    initialServer: null,
    ...overrides,
  }
}

function installWebBootstrap(bootstrap: ClientBootstrapSnapshot): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: bootstrap,
      location: {
        href: bootstrap.initialServer?.url ?? 'http://127.0.0.1:32100/',
        origin: bootstrap.initialServer?.url?.replace(/\/$/, '') ?? 'http://127.0.0.1:32100',
        protocol: 'http:',
        search: '',
      },
      matchMedia: vi.fn(() => ({ matches: true })),
    },
  })
}

function testBridge(overrides: Partial<RendererBridge> = {}): RendererBridge {
  return {
    kind: () => 'web',
    hasCapability: () => false,
    getBootstrap: () => electronBootstrap(),
    invokeIpc: vi.fn(),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: () => Promise.resolve([]),
    shell: () => null,
    terminal: (() => {
      throw new Error('unused terminal bridge')
    }) as never,
    ...overrides,
  }
}

describe('repo-client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setRendererBridgeForTests(null)
  })

  test('opens repository remote through the native shell bridge when available', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    window.open = vi.fn(() => null)
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    const openExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }))
    bridgeModule.setRendererBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
        shell: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl,
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
          openInFinder: vi.fn(),
        }),
      }),
    )
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { openRepositoryRemote } = await import('#/web/repo-client.ts')
    await expect(openRepositoryRemote('/tmp/repo', 'feature/test')).resolves.toEqual({ ok: true, message: '' })
    expect(openExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/acme/repo/tree/feature/test',
      allowHttp: true,
    })
    expect(window.open).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/open-remote',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/test' }),
      }),
    )
  })

  test('clones repositories through the embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok', path: '/tmp/repo' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { cloneRepository } = await import('#/web/repo-client.ts')
    const { hasNativeDirectoryPicker } = await import('#/web/app-shell-client.ts')
    expect(hasNativeDirectoryPicker()).toBe(false)
    await expect(
      cloneRepository({
        operationId: 'op_1',
        url: 'https://example.com/repo.git',
        parentPath: '/tmp',
        directoryName: 'repo',
      }),
    ).resolves.toEqual({ ok: true, message: 'ok', path: '/tmp/repo' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/clone',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
  })

  test('throws when repository log returns an error envelope', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, message: 'error.failed-read-repo' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getRepositoryLog } = await import('#/web/repo-client.ts')
    await expect(getRepositoryLog('/tmp/repo', 'feature/work')).rejects.toThrow('error.failed-read-repo')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/log',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/work', count: 50, skip: 0 }),
      }),
    )
  })

  test('opens terminal and editor through embedded server routes even when a native shell exists', async () => {
    const openTerminal = vi.fn(async () => ({ ok: true, message: 'native-terminal' }))
    const openEditor = vi.fn(async () => ({ ok: true, message: 'native-editor' }))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-terminal' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-editor' }) })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: CLIENT_BRIDGE_VERSION,
            capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
          },
          invokeIpc: vi.fn(),
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
          shell: {
            openSettingsWindow: vi.fn(),
            openExternalUrl: vi.fn(),
            openDirectoryDialog: vi.fn(),
            consumeExternalOpenPaths: vi.fn(),
            openInFinder: vi.fn(),
            openTerminal,
            openEditor,
          },
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const { openRepositoryEditor, openRepositoryTerminal } = await import('#/web/repo-client.ts')
    await expect(openRepositoryTerminal('/tmp/repo')).resolves.toEqual({ ok: true, message: 'server-terminal' })
    await expect(openRepositoryEditor('/tmp/repo')).resolves.toEqual({ ok: true, message: 'server-editor' })
    expect(openTerminal).not.toHaveBeenCalled()
    expect(openEditor).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/repo/open-terminal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ path: '/tmp/repo' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/repo/open-editor',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ path: '/tmp/repo' }),
      }),
    )
  })
})
