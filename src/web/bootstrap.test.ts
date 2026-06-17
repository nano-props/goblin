import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import type { InitialSettingsSnapshot, RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

function webBootstrap(overrides: Partial<RendererBootstrapSnapshot> = {}): RendererBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
    homeDir: '',
    platform: 'web',
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
    platform: 'web',
    initialI18n: null,
    initialSettings: null,
    initialServer: null,
    ...overrides,
  }
}

describe('renderer bootstrap', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    setRendererBridgeForTests(null)
    vi.resetModules()
  })

  test('reads bootstrap snapshots from the goblin bridge', async () => {
    const initialSettings: InitialSettingsSnapshot = {
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      globalShortcutRegistered: false,
      terminalApp: 'auto',
      editorApp: 'windsurf',
      lanEnabled: false,
    }
    const bootstrap: RendererBootstrapSnapshot = electronBootstrap({
      initialI18n: { lang: 'ko', pref: 'ko', dict: { hello: '안녕' } },
      initialSettings,
      initialServer: null,
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblinNative: {
          runtime: bootstrap.runtime,
          homeDir: bootstrap.homeDir,
          platform: bootstrap.platform,
          initialI18n: bootstrap.initialI18n,
          initialSettings: bootstrap.initialSettings,
          initialServer: bootstrap.initialServer,
        },
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('falls back when the goblin bridge is unavailable', async () => {
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
      homeDir: '',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })
  })

  test('re-detects the Electron bridge after an early web-host bootstrap', async () => {
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
      homeDir: '',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblinNative: {
          runtime: {
            kind: 'electron',
            bridgeVersion: RENDERER_BRIDGE_VERSION,
            capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
          },
          homeDir: '/Users/later',
          platform: 'web',
          initialI18n: null,
          initialSettings: null,
          initialServer: null,
          invokeIpc: async () => null,
          abortIpc: async () => false,
          onEvent: () => () => {},
          pathForFile: () => '',
          terminal: {
            attach: async () => ({ ok: false, message: 'unavailable' }),
            restart: async () => ({ ok: false, message: 'unavailable' }),
            write: async () => false,
            resize: async () => false,
            close: async () => false,
            create: async () => ({ ok: false, message: 'unavailable' }),
            pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
            notifyBell: async () => false,
            sendTestNotification: async () => false,
            setBadge: () => {},
            onOutput: () => () => {},
            onTitle: () => () => {},
            onExit: () => () => {},
          },
        },
      },
    })

    expect(getInitialBootstrap()).toEqual({
      runtime: {
        kind: 'electron',
        bridgeVersion: RENDERER_BRIDGE_VERSION,
        capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
      },
      homeDir: '/Users/later',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })
  })

  test('prefers the configured renderer bridge over directly reading window.goblinNative', async () => {
    const bootstrap: RendererBootstrapSnapshot = webBootstrap({
      homeDir: '/Users/host',
      initialServer: { url: 'http://127.0.0.1:32100', secret: 'secret', clientId: 'client_sharedterminal' },
    })
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    bridgeModule.setRendererBridgeForTests({
      kind: () => 'web',
      hasCapability: () => false,
      getBootstrap: () => bootstrap,
      invokeIpc: async () => null,
      abortIpc: async () => false,
      onIpcEvent: () => () => {},
      onEffectIntent: () => () => {},
      pathForFile: () => '',
      saveClipboardFiles: () => Promise.resolve([]),
      shell: () => null,
      terminal: () => ({
        attach: async () => ({ ok: false, message: 'unavailable' }),
        restart: async () => ({ ok: false, message: 'unavailable' }),
        write: async () => false,
        resize: async () => false,
        takeover: async () => ({ ok: false as const, message: 'error.invalid-arguments' }),
        close: async () => false,
        create: async (input?: { kind?: string }) =>
          input?.kind === 'primary'
            ? { ok: true as const, action: 'reused' as const, key: 'repo\0worktree\0terminal-1', sessions: [] }
            : { ok: true as const, action: 'created' as const, key: 'repo\0worktree\0terminal-2', sessions: [] },
        pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
        listSessions: async () => [],
        prewarm: async () => {},
        getSessionSnapshot: async () => null,
        reorder: async () => false,
        notifyBell: async () => false,
        sendTestNotification: async () => false,
        setBadge: () => {},
        onOutput: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onOwnership: () => () => {},
        onSessionsChanged: () => () => {},
      }),
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('reads injected web bootstrap when the Electron bridge is unavailable', async () => {
    const bootstrap: RendererBootstrapSnapshot = webBootstrap({
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: bootstrap,
        location: { href: 'http://127.0.0.1:32100/', origin: 'http://127.0.0.1:32100', search: '' },
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('reads injected web bootstrap from the html json script when the Electron bridge is unavailable', async () => {
    const bootstrap: RendererBootstrapSnapshot = webBootstrap({
      homeDir: '/Users/tester',
      initialI18n: { lang: 'ko', pref: 'ko', dict: { hello: '안녕' } },
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'http://127.0.0.1:32100/', origin: 'http://127.0.0.1:32100', search: '' },
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        getElementById: (id: string) => (id === 'goblin-bootstrap' ? { textContent: JSON.stringify(bootstrap) } : null),
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('builds a minimal web bootstrap from URL query parameters', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'http://127.0.0.1:32100/?goblinServerSecret=test-secret',
          origin: 'http://127.0.0.1:32100',
          search: '?goblinServerSecret=test-secret',
        },
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
      homeDir: '',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: {
        url: 'http://127.0.0.1:32100/',
        secret: 'test-secret',
        clientId: expect.stringMatching(/^web_/),
      },
    })
  })
})
