import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'

function webBootstrap(overrides: Partial<RendererBootstrapSnapshot> = {}): RendererBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
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

describe('settings-client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    setRendererBridgeForTests(null)
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
          swapCloseShortcuts: false,
          globalShortcut: 'CommandOrControl+Shift+G',
          globalShortcutRegistered: false,
          terminalApp: 'auto',
          editorApp: 'auto',
          lanEnabled: false,
          session: {
            openRepos: [],
            activeRepo: null,
            workspaceFocused: true,
            workspacePaneSizes: { 'left-right': 50 },
          },
          recentRepos: [],
        }),
      })),
    )

    const { getThemeState } = await import('#/web/settings-client.ts')
    await expect(getThemeState()).resolves.toEqual({ pref: 'auto', resolved: 'dark', colorTheme: 'default' })
  })

  test('returns authoritative theme state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
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
          globalShortcut: 'CommandOrControl+Shift+G',
          terminalApp: 'auto',
          editorApp: 'auto',
          lanEnabled: false,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setThemePref } = await import('#/web/settings-client.ts')
    await expect(setThemePref('dark')).resolves.toEqual({ pref: 'dark', resolved: 'dark', colorTheme: 'github' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('fetches i18n payload from embedded server when no Electron bridge exists', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { getI18nSnapshot } = await import('#/web/settings-client.ts')
    await expect(getI18nSnapshot()).resolves.toEqual({ lang: 'ko', pref: 'auto', dict: { hello: '안녕' } })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/i18n',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn().mockResolvedValueOnce({
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
          globalShortcut: 'CommandOrControl+Shift+G',
          terminalApp: 'auto',
          editorApp: 'auto',
          lanEnabled: false,
        },
        i18n: { lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { setI18nPref } = await import('#/web/settings-client.ts')
    await expect(setI18nPref('ja')).resolves.toEqual({ lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(invokeIpc).toHaveBeenCalledWith(
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
        addedRepo: { kind: 'local', id: '/tmp/repo' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { addRecentRepo } = await import('#/web/settings-client.ts')
    await expect(addRecentRepo({ kind: 'local', id: '/tmp/../tmp/repo' })).resolves.toMatchObject({
      recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
      addedRepo: { kind: 'local', id: '/tmp/repo' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-repos/add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
        body: JSON.stringify({ repo: { kind: 'local', id: '/tmp/../tmp/repo' } }),
      }),
    )
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: {
          recentRepos: {
            recentRepos: [{ kind: 'local', id: '/tmp/repo' }],
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { clearRecentRepos } = await import('#/web/settings-client.ts')
    await expect(clearRecentRepos()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:32100/api/settings/recent-repos/clear',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goblin-access-token': 'secret' }),
      }),
    )
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    expect(invokeIpc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'settings.applyShellProjection',
        input: { recentRepos: { recentRepos: [] } },
      }),
    )
  })

  test('returns authoritative terminal app state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
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
            appAvailability: { ghostty: true, terminal: false, windowsTerminal: false },
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

    const { setPreferredTerminalApp } = await import('#/web/settings-client.ts')
    await expect(setPreferredTerminalApp('ghostty')).resolves.toEqual({
      pref: 'ghostty',
      resolved: 'ghostty',
      available: true,
      appAvailability: { ghostty: true, terminal: false, windowsTerminal: false },
      detectedAt: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('returns authoritative editor app state directly from the settings write response', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
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
            appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
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

    const { setPreferredEditorApp } = await import('#/web/settings-client.ts')
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentRepos: [{ kind: 'local', id: '/existing' }],
        addedRepo: null,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { addRecentRepo } = await import('#/web/settings-client.ts')
    await expect(
      addRecentRepo({ kind: 'local', id: '/bad\0repo' } as unknown as { kind: 'local'; id: string }),
    ).resolves.toMatchObject({
      recentRepos: [{ kind: 'local', id: '/existing' }],
      addedRepo: null,
    })
    expect(invokeIpc).toHaveBeenCalledWith(
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

  // Best-effort projection IPC: the server is the authority, the
  // native bridge projection is a mirror for the menu state. A
  // projection IPC failure must not reject the caller's promise —
  // the server write already committed (otherwise `result` would
  // have thrown). Rejecting here would surface a misleading
  // "settings write failed" toast on top of a successful write.
  test('keeps the server-side setting committed when the native projection IPC rejects', async () => {
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        settings: {
          theme: 'dark',
          colorTheme: 'macos',
          shortcutsDisabled: false,
          globalShortcutDisabled: false,
          swapCloseShortcuts: false,
        },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { setThemePref } = await import('#/web/settings-client.ts')
    await expect(setThemePref('dark')).resolves.toMatchObject({ pref: 'dark' })
    expect(invokeIpc).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('keeps recent repos committed when the projection IPC rejects', async () => {
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        recentRepos: [{ kind: 'local', id: '/persisted' }],
        addedRepo: { kind: 'local', id: '/persisted' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { addRecentRepo } = await import('#/web/settings-client.ts')
    await expect(addRecentRepo({ kind: 'local', id: '/persisted' })).resolves.toMatchObject({
      recentRepos: [{ kind: 'local', id: '/persisted' }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('keeps the cleared recent-repos list when the projection IPC rejects', async () => {
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
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { clearRecentRepos } = await import('#/web/settings-client.ts')
    await expect(clearRecentRepos()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
