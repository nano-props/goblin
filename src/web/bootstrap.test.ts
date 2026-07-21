import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

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

describe('client bootstrap', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'document')
    setClientBridgeForTests(null)
    vi.resetModules()
  })

  test('reads bootstrap snapshots from the goblin bridge', async () => {
    const bootstrap: ClientBootstrapSnapshot = electronBootstrap({
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    })
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        // The bootstrap is now the single source of truth for the
        // tiny client-state payload (runtime kind, initial server
        // handoff). Host info (homeDir, platform) and i18n live
        // on dedicated `/api/*` endpoints fetched by
        // the client bootstrap hooks, not in the bootstrap.
        __GOBLIN_BOOTSTRAP__: bootstrap,
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('falls back when the goblin bridge is unavailable', async () => {
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: null,
    })
  })

  test('replaces a partial web bootstrap once the bridge populates fully', async () => {
    // Regression for the "all-defaults lock" gate: the previous
    // version only re-read on a fully-empty snapshot, so a partial
    // read (e.g. initialServer still null) would lock the cache
    // and never pick up the populated version. The new gate
    // re-reads while the snapshot is "all default" (no initial
    // server handoff yet).
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: null,
    })

    // A later read returns a fully populated snapshot. The next
    // call must converge on it, even though the cached value is
    // the "all default" snapshot above.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
          initialServer: null,
        },
        location: { href: 'http://127.0.0.1:32100/', origin: 'http://127.0.0.1:32100', search: '' },
      },
    })

    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: null,
    })
  })

  test('re-detects the Electron bridge after an early web-host bootstrap', async () => {
    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: null,
    })

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        __GOBLIN_BOOTSTRAP__: {
          runtime: {
            kind: 'electron',
            bridgeVersion: CLIENT_BRIDGE_VERSION,
            capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
          },
          initialServer: null,
        },
        goblinNative: {
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
            pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
            notifyBell: async () => false,
            sendTestNotification: async () => false,
            setBadge: () => {},
            onOutput: () => () => {},
            onBell: () => () => {},
            onTitle: () => () => {},
            onExit: () => () => {},
          },
        },
      },
    })

    expect(getInitialBootstrap()).toEqual({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: null,
    })
  })

  test('prefers the configured client bridge over directly reading window.goblinNative', async () => {
    const bootstrap: ClientBootstrapSnapshot = webBootstrap({
      initialServer: { url: 'http://127.0.0.1:32100', accessToken: 'secret' },
    })
    const bridgeModule = await import('#/web/client-bridge.ts')
    bridgeModule.setClientBridgeForTests({
      kind: () => 'web',
      hasCapability: () => false,
      getBootstrap: () => bootstrap,
      invokeIpc: async () => null,
      abortIpc: async () => false,
      onIpcEvent: () => () => {},
      onEffectIntent: () => () => {},
      pathForFile: () => '',
      saveClipboardFiles: () => Promise.resolve([]),
      host: () => null,
      appRealtime: () => ({
        kickReconnect: () => {},
        onRecovered: () => () => {},
      }),
      terminal: () => ({
        attach: async () => ({ ok: false, message: 'unavailable' }),
        restart: async () => ({ ok: false, message: 'unavailable' }),
        write: async () => ({ status: 'rejected' }),
        resize: async () => false,
        takeover: async () => ({ ok: false as const, message: 'error.invalid-arguments' }),
        close: async () => false,
        pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
        recoverSessions: async () => ({ revision: 0, sessions: [] }),
        notifyBell: async () => false,
        sendTestNotification: async () => false,
        setBadge: () => {},
        onOutput: () => () => {},
        onBell: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onIdentity: () => () => {},
        onLifecycle: () => () => {},
        onSessionsChanged: () => () => {},
        onSessionClosed: () => () => {},
      }),
      workspacePaneTabs: () => ({
        replace: async (input) => ({
          revision: 1,
          entries: [
            {
              target: input.target,
              tabs: input.tabs,
            },
          ],
        }),
        update: async () => ({ revision: 0, entries: [] }),
        list: async () => ({ revision: 0, entries: [] }),
        onChanged: () => () => {},
      }),
      workspacePaneRuntime: () => ({
        open: async () => ({ ok: false, runtimeType: 'terminal', message: 'unavailable' }),
        close: async () => ({ ok: false, runtimeType: 'terminal', message: 'unavailable' }),
      }),
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('reads injected web bootstrap when the Electron bridge is unavailable', async () => {
    const bootstrap: ClientBootstrapSnapshot = webBootstrap({
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
    const bootstrap: ClientBootstrapSnapshot = webBootstrap({
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
    // The dev-mode escape hatch: `?accessToken=...` in the URL
    // populates the bootstrap so a Vite-served browser can attach
    // the token as a header. The old `?goblinServerSecret=...`
    // query was the original per-launch-secret leak; the new name
    // matches the field on `InitialServerSnapshot`.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          href: 'http://127.0.0.1:32100/?accessToken=test-secret',
          origin: 'http://127.0.0.1:32100',
          search: '?accessToken=test-secret',
        },
      },
    })

    const { getInitialBootstrap } = await import('#/web/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
      initialServer: {
        url: 'http://127.0.0.1:32100/',
        accessToken: 'test-secret',
      },
    })
  })
})
