import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

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

describe('settings-client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setClientBridgeForTests(null)
  })

  test('reads theme state from embedded server settings when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          theme: 'auto',
          colorTheme: 'default',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          globalShortcutRegistered: false,
          lanEnabled: false,
          session: {
            openWorkspaceEntries: [],
            restoredWorkspaceId: null,
            zenMode: true,
            workspacePaneSize: 50,
            selectedTerminalSessionIdByTerminalFilesystemTarget: {},
            workspacePaneTabsByTargetByWorkspace: {},
          },
          recentWorkspaces: [],
        }),
      })),
    )

    const { getThemeState } = await import('#/web/settings-client.ts')
    await expect(getThemeState()).resolves.toEqual({ pref: 'auto', resolved: 'dark', colorTheme: 'default' })
  })

  test('returns authoritative theme state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        prefs: {
          lang: 'auto',
          theme: 'dark',
          colorTheme: 'github',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          lanEnabled: false,
        },
      }),
    }))
    const { setThemePref } = await import('#/web/settings-client.ts')
    await expect(setThemePref('dark')).resolves.toEqual({ pref: 'dark', resolved: 'dark', colorTheme: 'github' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fetches i18n payload from embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } }),
    }))
    const { getI18nSnapshot } = await import('#/web/settings-client.ts')
    await expect(getI18nSnapshot()).resolves.toEqual({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/i18n',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
  })

  test('passes abort signal through when fetching i18n payload', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(signal.reason)
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const controller = new AbortController()

    const { getI18nSnapshot } = await import('#/web/settings-client.ts')
    const request = getI18nSnapshot({ signal: controller.signal })
    const assertion = expect(request).rejects.toThrow('cancelled')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const requestSignal = init.signal
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(controller.signal)
    expect(requestSignal?.aborted).toBe(false)
    controller.abort(new Error('cancelled'))
    expect(requestSignal?.aborted).toBe(true)
    await assertion
  })

  test('posts the active repo root when restoring the workspace session', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const workspace = defaultServerWorkspaceState()
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        status: 'restored',
        openWorkspaceEntries: [],
        workspace,
        runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: null },
      }),
    }))

    const { restoreServerWorkspace } = await import('#/web/settings-client.ts')
    await expect(
      restoreServerWorkspace('client_test000000000000', {
        activeWorkspaceId: workspaceIdForTest('goblin+file:///workspace'),
      }),
    ).resolves.toEqual({
      status: 'restored',
      openWorkspaceEntries: [],
      workspace,
      runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: null },
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      clientId: 'client_test000000000000',
      activeWorkspaceId: 'goblin+file:///workspace',
    })
  })

  test('posts repo root and runtime id when lazily restoring repo tabs', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const restored = {
      repo: {
        entry: { kind: 'local' as const, id: 'goblin+file:///tmp/routed-repo' },
        repoRoot: 'goblin+file:///tmp/routed-repo',
        workspaceRuntimeId: 'repo_runtime_test',
        name: 'routed-repo',
        gitProjection: {
          snapshot: { current: 'main', branches: [] },
          status: [],
          pullRequests: null,
          operations: { operations: [], loadedAt: 0 },
          requested: { branch: null, pullRequestMode: 'full' as const },
          loadedAt: 1,
        },
      },
      snapshot: null,
    }
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => restored,
    }))

    const { restoreWorkspaceTabs } = await import('#/web/settings-client.ts')
    await expect(
      restoreWorkspaceTabs(
        'client_test000000000000',
        workspaceIdForTest('goblin+file:///tmp/routed-repo'),
        'repo_runtime_test',
      ),
    ).resolves.toEqual(restored)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      clientId: 'client_test000000000000',
      workspaceId: 'goblin+file:///tmp/routed-repo',
      workspaceRuntimeId: 'repo_runtime_test',
    })
  })

  test('sets the global shortcut through the native bridge even when the embedded server is available', async () => {
    const invokeIpc = vi.fn(async () => ({ accelerator: 'CommandOrControl+Shift+K', registered: true }))
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch()
    const { setGlobalShortcut } = await import('#/web/settings-client.ts')
    await expect(setGlobalShortcut('CommandOrControl+Shift+K')).resolves.toEqual({
      accelerator: 'CommandOrControl+Shift+K',
      registered: true,
    })
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.setGlobalShortcut',
        input: { accelerator: 'CommandOrControl+Shift+K' },
      }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('projects native prefs after updating language through the embedded server', async () => {
    const invokeIpc = vi.fn(async () => undefined)
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        prefs: {
          lang: 'ja',
          theme: 'auto',
          colorTheme: 'macos',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          lanEnabled: false,
        },
        i18n: { lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } },
      }),
    })
    const { setI18nPref } = await import('#/web/settings-client.ts')
    await expect(setI18nPref('ja')).resolves.toEqual({ lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyNativeHostProjection',
        input: {
          prefs: {
            patch: { lang: 'ja' },
            settings: {
              lang: 'ja',
              theme: 'auto',
              colorTheme: 'macos',
              shortcutsDisabled: false,
              globalShortcutDisabled: false,
              globalShortcut: 'CommandOrControl+Shift+G',
            },
          },
        },
      }),
    )
  })

  test('rejects language updates that do not return an authoritative i18n snapshot', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        prefs: {
          lang: 'ja',
          theme: 'auto',
          colorTheme: 'macos',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          lanEnabled: false,
        },
      }),
    }))

    const { setI18nPref } = await import('#/web/settings-client.ts')
    await expect(setI18nPref('ja')).rejects.toThrow('settings language update did not return i18n snapshot')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('projects recent repos through the native bridge', async () => {
    const invokeIpc = vi.fn(async () => undefined)
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///tmp/repo' }],
        addedWorkspace: { kind: 'local', id: 'goblin+file:///tmp/repo' },
      }),
    }))
    const { addRecentWorkspace } = await import('#/web/settings-client.ts')
    await expect(
      addRecentWorkspace({ kind: 'local', id: workspaceIdForTest('goblin+file:///tmp/repo') }),
    ).resolves.toMatchObject({
      recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///tmp/repo' }],
      addedWorkspace: { kind: 'local', id: 'goblin+file:///tmp/repo' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-workspaces/add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ workspace: { kind: 'local', id: 'goblin+file:///tmp/repo' } }),
      }),
    )
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyNativeHostProjection',
        input: {
          recentWorkspaces: {
            recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///tmp/repo' }],
          },
        },
      }),
    )
  })

  test('clears recent repos through the embedded server and syncs native state', async () => {
    const invokeIpc = vi.fn(async () => undefined)
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          onIntent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    const { clearRecentWorkspaces } = await import('#/web/settings-client.ts')
    await expect(clearRecentWorkspaces()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-workspaces/clear',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyNativeHostProjection',
        input: { recentWorkspaces: { recentWorkspaces: [] } },
      }),
    )
  })

  test('does not project an added recent repo when the embedded server rejects the candidate', async () => {
    const invokeIpc = vi.fn(async () => undefined)
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///existing' }],
        addedWorkspace: null,
      }),
    }))
    const { addRecentWorkspace } = await import('#/web/settings-client.ts')
    await expect(
      addRecentWorkspace({ kind: 'local', id: workspaceIdForTest('goblin+file:///candidate') }),
    ).resolves.toMatchObject({
      recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///existing' }],
      addedWorkspace: null,
    })
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyNativeHostProjection',
        input: {
          recentWorkspaces: {
            recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///existing' }],
          },
        },
      }),
    )
  })

  test('rejects when a committed setting cannot be projected to the native host', async () => {
    const invokeIpc = vi.fn(async () => {
      throw new Error('native bridge wedged')
    })
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        prefs: {
          theme: 'dark',
          colorTheme: 'macos',
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
        },
      }),
    }))
    const { setThemePref } = await import('#/web/settings-client.ts')
    await expect(setThemePref('dark')).rejects.toThrow('native bridge wedged')
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('rejects when committed recent repos cannot be projected to the native host', async () => {
    const invokeIpc = vi.fn(async () => {
      throw new Error('projection IPC rejected')
    })
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///persisted' }],
        addedWorkspace: { kind: 'local', id: 'goblin+file:///persisted' },
      }),
    }))
    const { addRecentWorkspace } = await import('#/web/settings-client.ts')
    await expect(
      addRecentWorkspace({ kind: 'local', id: workspaceIdForTest('goblin+file:///persisted') }),
    ).rejects.toThrow('projection IPC rejected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('rejects when clearing recent repos cannot be projected to the native host', async () => {
    const invokeIpc = vi.fn(async () => {
      throw new Error('projection IPC rejected')
    })
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
          invokeIpc,
          abortIpc: async () => true,
          onEvent: () => () => {},
          pathForFile: () => '',
        },
        location: {
          href: 'http://127.0.0.1:32100/',
          origin: 'http://127.0.0.1:32100',
          search: '',
        },
        matchMedia: vi.fn(() => ({ matches: true })),
      },
    })
    const fetchMock = mockFetch(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    const { clearRecentWorkspaces } = await import('#/web/settings-client.ts')
    await expect(clearRecentWorkspaces()).rejects.toThrow('projection IPC rejected')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
