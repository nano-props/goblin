import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

function webBootstrap(overrides: Partial<RendererBootstrapSnapshot> = {}): RendererBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
    homeDir: '',
    initialI18n: null,
    initialSettings: null,
    initialServer: null,
    ...overrides,
  }
}

function electronBootstrap(overrides: Partial<RendererBootstrapSnapshot> = {}): RendererBootstrapSnapshot {
  return {
    runtime: {
      kind: 'electron',
      bridgeVersion: RENDERER_BRIDGE_VERSION,
      capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
    },
    homeDir: '/Users/test',
    initialI18n: null,
    initialSettings: null,
    initialServer: null,
    ...overrides,
  }
}

function installWebBootstrap(bootstrap: RendererBootstrapSnapshot): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: bootstrap,
      location: {
        href: bootstrap.initialServer?.url ?? 'http://127.0.0.1:32100/',
        origin: bootstrap.initialServer?.url?.replace(/\/$/, '') ?? 'http://127.0.0.1:32100',
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
    invokeRpc: vi.fn(),
    abortRpc: vi.fn(async () => false),
    onRpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    shell: () => null,
    terminal: (() => {
      throw new Error('unused terminal bridge')
    }) as never,
    ...overrides,
  }
}

describe('server-client web host bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setRendererBridgeForTests(null)
  })

  test('reads theme state from embedded server settings when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
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
          swapCloseShortcuts: false,
          toggleDetailOnActionBarBlankClick: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          globalShortcutRegistered: false,
          terminalApp: 'auto',
          editorApp: 'auto',
          lanEnabled: false,
          session: {
            openRepos: [],
            activeRepo: null,
            detailCollapsed: true,
            detailFocusMode: false,
            workspaceLayout: 'top-bottom',
            detailPaneSizes: { 'top-bottom': 50, 'left-right': 50 },
          },
          recentRepos: [],
        }),
      })),
    )

    const { getThemeState } = await import('#/web/app-data-client.ts')
    await expect(getThemeState()).resolves.toEqual({ pref: 'auto', resolved: 'dark', colorTheme: 'default' })
  })

  test('returns authoritative theme state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        settings: {
          lang: 'auto',
          theme: 'dark',
          colorTheme: 'github',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          swapCloseShortcuts: false,
          toggleDetailOnActionBarBlankClick: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          terminalApp: 'auto',
          editorApp: 'auto',
          lanEnabled: false,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setThemePref } = await import('#/web/app-data-client.ts')
    await expect(setThemePref('dark')).resolves.toEqual({ pref: 'dark', resolved: 'dark', colorTheme: 'github' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fetches i18n payload from embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getI18nSnapshot } = await import('#/web/app-data-client.ts')
    await expect(getI18nSnapshot()).resolves.toEqual({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/i18n',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
      }),
    )
  })

  test('opens repository remote through the native shell bridge when available', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    window.open = vi.fn(() => null)
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    const openExternalUrl = vi.fn(async () => ({ ok: true, message: 'https://github.com/acme/repo/tree/feature/test' }))
    bridgeModule.setRendererBridgeForTests(
      testBridge({
        getBootstrap: () => ({
          ...webBootstrap(),
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
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

    const { openRepositoryRemote } = await import('#/web/app-data-client.ts')
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
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ cwd: '/tmp/repo', branch: 'feature/test' }),
      }),
    )
  })

  test('clones repositories through the embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, message: 'ok', path: '/tmp/repo' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { cloneRepository } = await import('#/web/app-data-client.ts')
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
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
      }),
    )
  })

  test('sets the global shortcut through the native bridge even when the embedded server is available', async () => {
    const invokeRpc = vi.fn(async () => ({ accelerator: 'CommandOrControl+Shift+K', registered: true }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc,
          abortRpc: async () => true,
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
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { setGlobalShortcut } = await import('#/web/app-data-client.ts')
    await expect(setGlobalShortcut('CommandOrControl+Shift+K')).resolves.toEqual({
      accelerator: 'CommandOrControl+Shift+K',
      registered: true,
    })
    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.setGlobalShortcut',
        input: { accelerator: 'CommandOrControl+Shift+K' },
      }),
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('projects native prefs after updating language through the embedded server', async () => {
    const invokeRpc = vi.fn(async () => undefined)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc,
          abortRpc: async () => true,
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          settings: {
            lang: 'ja',
            theme: 'auto',
            colorTheme: 'macos',
            fetchIntervalSec: 120,
            terminalNotificationsEnabled: false,
            shortcutsDisabled: false,
            globalShortcutDisabled: false,
            swapCloseShortcuts: false,
            toggleDetailOnActionBarBlankClick: false,
            globalShortcut: 'CommandOrControl+Shift+G',
            terminalApp: 'auto',
            editorApp: 'auto',
            lanEnabled: false,
          },
          i18n: { lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { setI18nPref } = await import('#/web/app-data-client.ts')
    await expect(setI18nPref('ja')).resolves.toEqual({ lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: {
          prefs: {
            patch: { lang: 'ja' },
            settings: {
              lang: 'ja',
              theme: 'auto',
              colorTheme: 'macos',
              shortcutsDisabled: false,
              globalShortcutDisabled: false,
              swapCloseShortcuts: false,
              globalShortcut: 'CommandOrControl+Shift+G',
            },
          },
        },
      }),
    )
  })

  test('projects recent repos through the native bridge using the server-authoritative added repo', async () => {
    const invokeRpc = vi.fn(async () => undefined)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc,
          abortRpc: async () => true,
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
        addedRepo: { kind: 'local', id: '/tmp/repo' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { addRecentRepo } = await import('#/web/app-data-client.ts')
    await expect(addRecentRepo({ kind: 'local', id: '/tmp/../tmp/repo' })).resolves.toMatchObject({
      recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
      addedRepo: { kind: 'local', id: '/tmp/repo' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-repos/add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ repo: { kind: 'local', id: '/tmp/../tmp/repo' } }),
      }),
    )
    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: {
          recentRepos: {
            recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
            addedRepo: { kind: 'local', id: '/tmp/repo' },
          },
        },
      }),
    )
  })

  test('clears recent repos through the embedded server and then clears native recent documents', async () => {
    const invokeRpc = vi.fn(async () => undefined)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc,
          abortRpc: async () => true,
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { clearRecentRepos } = await import('#/web/app-data-client.ts')
    await expect(clearRecentRepos()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-repos/clear',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
      }),
    )
    expect(invokeRpc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: { recentRepos: { recentRepos: [] } },
      }),
    )
    expect(invokeRpc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: 'settings.clearNativeRecentDocuments',
      }),
    )
  })

  test('returns authoritative terminal app state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        settings: {
          lang: 'auto',
          theme: 'auto',
          colorTheme: 'macos',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          swapCloseShortcuts: false,
          toggleDetailOnActionBarBlankClick: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          terminalApp: 'ghostty',
          editorApp: 'auto',
          lanEnabled: false,
        },
        externalApps: {
          terminal: {
            pref: 'ghostty',
            resolved: 'ghostty',
            available: true,
            appAvailability: { ghostty: true, terminal: false },
            detectedAt: 1,
          },
          editor: {
            pref: 'auto',
            resolved: null,
            available: false,
            appAvailability: { vscode: false, cursor: false, windsurf: false },
            detectedAt: 1,
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setPreferredTerminalApp } = await import('#/web/app-data-client.ts')
    await expect(setPreferredTerminalApp('ghostty')).resolves.toEqual({
      pref: 'ghostty',
      resolved: 'ghostty',
      available: true,
      appAvailability: { ghostty: true, terminal: false },
      detectedAt: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('returns authoritative editor app state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        settings: {
          lang: 'auto',
          theme: 'auto',
          colorTheme: 'macos',
          fetchIntervalSec: 120,
          terminalNotificationsEnabled: false,
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          swapCloseShortcuts: false,
          toggleDetailOnActionBarBlankClick: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          terminalApp: 'auto',
          editorApp: 'cursor',
          lanEnabled: false,
        },
        externalApps: {
          terminal: {
            pref: 'auto',
            resolved: null,
            available: false,
            appAvailability: { ghostty: false, terminal: false },
            detectedAt: 1,
          },
          editor: {
            pref: 'cursor',
            resolved: 'cursor',
            available: true,
            appAvailability: { vscode: true, cursor: true, windsurf: false },
            detectedAt: 1,
          },
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setPreferredEditorApp } = await import('#/web/app-data-client.ts')
    await expect(setPreferredEditorApp('cursor')).resolves.toEqual({
      pref: 'cursor',
      resolved: 'cursor',
      available: true,
      appAvailability: { vscode: true, cursor: true, windsurf: false },
      detectedAt: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not project an added recent repo when the embedded server rejects the candidate', async () => {
    const invokeRpc = vi.fn(async () => undefined)
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: electronBootstrap({
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc,
          abortRpc: async () => true,
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentRepos: [{ kind: 'local', id: '/existing' }],
        addedRepo: null,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { addRecentRepo } = await import('#/web/app-data-client.ts')
    await expect(addRecentRepo({ kind: 'local', id: '/bad\0repo' } as unknown as { kind: 'local'; id: string })).resolves.toMatchObject({
      recentRepos: [{ kind: 'local', id: '/existing' }],
      addedRepo: null,
    })
    expect(invokeRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: {
          recentRepos: {
            recentRepos: [{ kind: 'local', id: '/existing' }],
          },
        },
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
          initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        }),
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/test',
          invokeRpc: vi.fn(),
          abortRpc: async () => true,
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

    const { openRepositoryEditor, openRepositoryTerminal } = await import('#/web/app-data-client.ts')
    await expect(openRepositoryTerminal('/tmp/repo')).resolves.toEqual({ ok: true, message: 'server-terminal' })
    await expect(openRepositoryEditor('/tmp/repo')).resolves.toEqual({ ok: true, message: 'server-editor' })
    expect(openTerminal).not.toHaveBeenCalled()
    expect(openEditor).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:32100/api/repo/open-terminal',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ path: '/tmp/repo' }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:32100/api/repo/open-editor',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-internal-secret': 'secret' }),
        body: JSON.stringify({ path: '/tmp/repo' }),
      }),
    )
  })
})
