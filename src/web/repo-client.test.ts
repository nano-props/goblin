import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

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

function testBridge(overrides: Partial<ClientBridge> = {}): ClientBridge {
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
    host: () => null,
    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: (() => {
      throw new Error('unused terminal client')
    }) as never,
    workspacePaneTabs: (() => {
      throw new Error('unused workspace pane tabs client')
    }) as never,
    workspacePaneRuntime: (() => {
      throw new Error('unused workspace pane runtime client')
    }) as never,
    ...overrides,
  }
}

describe('repo-client', () => {
  const repoRuntimeId = 'repo-runtime-test'

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('opens repository branch URLs through the native host bridge when available', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    window.open = vi.fn(() => null)
    const bridgeModule = await import('#/web/client-bridge.ts')
    const openExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }))
    bridgeModule.setClientBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
        host: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl,
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
        }),
      }),
    )
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }),
    }))
    const { openRepoUrl } = await import('#/web/repo-client.ts')
    await expect(openRepoUrl('/tmp/repo', repoRuntimeId, { type: 'branch', branch: 'feature/test' })).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(openExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/acme/repo/tree/feature/test',
      allowHttp: true,
    })
    expect(window.open).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/open-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', repoRuntimeId, target: { type: 'branch', branch: 'feature/test' } }),
      }),
    )
  })

  test('opens repository commit URLs through the native host bridge when available', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const bridgeModule = await import('#/web/client-bridge.ts')
    const openExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' }))
    bridgeModule.setClientBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        }),
        host: () => ({
          openSettingsWindow: vi.fn(),
          openExternalUrl,
          openDirectoryDialog: vi.fn(),
          consumeExternalOpenPaths: vi.fn(),
        }),
      }),
    )
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'https://github.com/acme/repo/commit/abcdef1' }),
    }))
    const { openRepoUrl } = await import('#/web/repo-client.ts')

    await expect(openRepoUrl('/tmp/repo', repoRuntimeId, { type: 'commit', hash: 'abcdef1' })).resolves.toEqual({
      ok: true,
      message: '',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/open-url',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', repoRuntimeId, target: { type: 'commit', hash: 'abcdef1' } }),
      }),
    )
    expect(openExternalUrl).toHaveBeenCalledWith({
      url: 'https://github.com/acme/repo/commit/abcdef1',
      allowHttp: true,
    })
  })

  test('clones repositories through the embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok', path: '/tmp/repo' }),
    }))
    const { cloneRepository } = await import('#/web/repo-client.ts')
    const { hasNativeDirectoryPicker } = await import('#/web/app-shell-client.ts')
    expect(hasNativeDirectoryPicker()).toBe(false)
    await expect(
      cloneRepository({
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
        body: JSON.stringify({
          url: 'https://example.com/repo.git',
          parentPath: '/tmp',
          directoryName: 'repo',
        }),
      }),
    )
  })

  test('times out long-running fetch requests with a stable error key', async () => {
    vi.useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    mockFetch((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const { fetchRepo } = await import('#/web/repo-client.ts')
    const request = fetchRepo('/tmp/repo', repoRuntimeId)
    const assertion = expect(request).rejects.toThrow('error.request-timeout')

    await vi.advanceTimersByTimeAsync(240_000)
    await assertion
  })

  test('aborts the clone request after the clone request watchdog fires', async () => {
    vi.useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let requestSignal: AbortSignal | undefined
    const fetchMock = mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const { cloneRepository } = await import('#/web/repo-client.ts')
    const request = cloneRepository({
      url: 'https://example.com/repo.git',
      parentPath: '/tmp',
      directoryName: 'repo',
    })

    await vi.advanceTimersByTimeAsync(360_000)
    await expect(request).resolves.toEqual({ ok: false, message: 'error.request-timeout' })
    expect(requestSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(String((fetchMock.mock.calls[0] as unknown as [unknown])[0])).pathname).toBe('/api/repo/clone')
  })

  test('gives remove-worktree a multi-step mutation request budget', async () => {
    vi.useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let requestSignal: AbortSignal | undefined
    mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const { removeRepoWorktree } = await import('#/web/repo-client.ts')
    const request = removeRepoWorktree('/tmp/repo', 'repo-runtime-test', {
      branch: 'feature/remove',
      worktreePath: '/tmp/repo-feature-remove',
      deleteBranch: true,
      deleteUpstream: true,
    })
    const assertion = expect(request).rejects.toThrow('error.request-timeout')

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(240_000)
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(360_000)
    await assertion
  })

  test('gives patch generation an explicit long-read request budget', async () => {
    vi.useFakeTimers()
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let requestSignal: AbortSignal | undefined
    mockFetch((_url, init) => {
      requestSignal = (init as RequestInit | undefined)?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true })
      })
    })

    const { getRepoPatch } = await import('#/web/repo-client.ts')
    const request = getRepoPatch('/tmp/repo', 'repo-runtime-test', '/tmp/repo-feature')
    const assertion = expect(request).rejects.toThrow('error.request-timeout')

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(780_000)
    await assertion
  })

  test('throws when repository log returns an error envelope', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: false, message: 'error.failed-read-repo' }),
    }))
    const { getRepoLog } = await import('#/web/repo-client.ts')
    await expect(getRepoLog('/tmp/repo', 'repo-runtime-test', 'feature/work')).rejects.toThrow('error.failed-read-repo')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/repo/log',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          cwd: '/tmp/repo',
          repoRuntimeId: 'repo-runtime-test',
          branch: 'feature/work',
          count: 50,
          skip: 0,
        }),
      }),
    )
  })

  test('opens external workspace apps through embedded server routes even when a native host exists', async () => {
    const openTerminal = vi.fn(async () => ({ ok: true, message: 'native-terminal' }))
    const openEditor = vi.fn(async () => ({ ok: true, message: 'native-editor' }))
    const fetchMock = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-terminal' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-editor' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-finder' }) }),
    )
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
          host: {
            openSettingsWindow: vi.fn(),
            openExternalUrl: vi.fn(),
            openDirectoryDialog: vi.fn(),
            consumeExternalOpenPaths: vi.fn(),
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
    const { openRepoEditor, openRepoInFinder, openRepoTerminal } = await import('#/web/repo-client.ts')
    await expect(openRepoTerminal('/tmp/repo', 'repo-runtime-test', '/tmp/repo', 'ghostty')).resolves.toEqual({
      ok: true,
      message: 'server-terminal',
    })
    await expect(openRepoEditor('/tmp/repo', 'repo-runtime-test', '/tmp/repo', 'vscode')).resolves.toEqual({
      ok: true,
      message: 'server-editor',
    })
    await expect(openRepoInFinder('/tmp/repo', '/tmp/repo')).resolves.toEqual({
      ok: true,
      message: 'server-finder',
    })
    expect(openTerminal).not.toHaveBeenCalled()
    expect(openEditor).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/repo/open-terminal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          repoId: '/tmp/repo',
          repoRuntimeId: 'repo-runtime-test',
          worktreePath: '/tmp/repo',
          app: 'ghostty',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/repo/open-editor',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({
          repoId: '/tmp/repo',
          repoRuntimeId: 'repo-runtime-test',
          worktreePath: '/tmp/repo',
          app: 'vscode',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:32100/api/repo/open-in-finder',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ repoId: '/tmp/repo', worktreePath: '/tmp/repo' }),
      }),
    )
  })

  test('sends explicit external app choices in open route bodies', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-terminal' }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, message: 'server-editor' }) }),
    )
    const { openRepoEditor, openRepoTerminal } = await import('#/web/repo-client.ts')
    await openRepoTerminal('/tmp/repo', 'repo-runtime-test', '/tmp/repo', 'ghostty')
    await openRepoEditor('/tmp/repo', 'repo-runtime-test', '/tmp/repo', 'vscode')

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/repo/open-terminal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoId: '/tmp/repo',
          repoRuntimeId: 'repo-runtime-test',
          worktreePath: '/tmp/repo',
          app: 'ghostty',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/repo/open-editor',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          repoId: '/tmp/repo',
          repoRuntimeId: 'repo-runtime-test',
          worktreePath: '/tmp/repo',
          app: 'vscode',
        }),
      }),
    )
  })
})
