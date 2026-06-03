import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import type { InitialSettingsSnapshot, RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'

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
    }
    const bootstrap: RendererBootstrapSnapshot = {
      homeDir: '/Users/test',
      initialI18n: { lang: 'ko', pref: 'ko', dict: { hello: '안녕' } },
      initialSettings,
      initialServer: null,
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblin: {
          homeDir: bootstrap.homeDir,
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
      homeDir: '',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })
  })

  test('re-detects the Electron bridge after an early web-host bootstrap', async () => {
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      homeDir: '',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblin: {
          homeDir: '/Users/later',
          initialI18n: null,
          initialSettings: null,
          initialServer: null,
          invokeRpc: async () => null,
          abortRpc: async () => false,
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
      homeDir: '/Users/later',
      initialI18n: null,
      initialSettings: null,
      initialServer: null,
    })
  })

  test('prefers the configured renderer bridge over directly reading window.goblin', async () => {
    const bootstrap: RendererBootstrapSnapshot = {
      homeDir: '/Users/host',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100', secret: 'secret', clientId: 'client_sharedterminal' },
    }
    const bridgeModule = await import('#/web/renderer-bridge.ts')
    bridgeModule.setRendererBridgeForTests({
      getBootstrap: () => bootstrap,
      invokeRpc: async () => null,
      abortRpc: async () => false,
      onRpcEvent: () => () => {},
      pathForFile: () => '',
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
        getSessionSnapshot: async () => null,
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
    const bootstrap: RendererBootstrapSnapshot = {
      homeDir: '',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    }
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
    const bootstrap: RendererBootstrapSnapshot = {
      homeDir: '/Users/tester',
      initialI18n: { lang: 'ko', pref: 'ko', dict: { hello: '안녕' } },
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    }
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
      homeDir: '',
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
