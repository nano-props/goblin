import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const next = this.listeners.get(type) ?? new Set()
    next.add(listener)
    this.listeners.set(type, next)
  }

  close(): void {
    this.emit('close', {})
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) })
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function installBridge(handlers: Record<string, () => unknown>) {
  const listeners = new Set<(event: any) => void>()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        homeDir: '/Users/test',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      goblinNative: {
        homeDir: '/Users/test',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        invokeRpc: ({ path }: { path: string }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled RPC path: ${path}`)
          return handler()
        },
        abortRpc: () => Promise.resolve(false),
        onEvent: (cb: (event: any) => void) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        pathForFile: () => '',
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      const call = (name: string) => {
        const handler = handlers[name]
        if (!handler) throw new Error(`Unhandled route: ${name}`)
        return handler()
      }
      const result = (() => {
        if (url.pathname === '/api/settings') return call('settings.get')
        if (url.pathname === '/api/settings/github-cli') return call('githubCli.get')
        if (url.pathname === '/api/settings/external-apps')
          return init?.method === 'POST' ? call('externalApps.refresh') : call('externalApps.get')
        if (url.pathname === '/api/settings/external-apps/refresh') return call('externalApps.refresh')
        if (url.pathname === '/api/settings/prefs') return { ok: true, settings: body.settings }
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      })()
      return {
        ok: true,
        json: async () => result,
      }
    }),
  )
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  setRendererBridgeForTests(null)
  return {
    emit(event: any) {
      for (const listener of listeners) listener(event)
      for (const socket of FakeWebSocket.instances) socket.emitMessage(event)
    },
  }
}

function resetSettingsStore(): void {
  useSettingsStore.setState({
    fetchIntervalSec: 120,
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    swapCloseShortcuts: false,
    toggleDetailOnActionBarBlankClick: false,
    globalShortcut: 'CommandOrControl+Shift+G',
    globalShortcutRegistered: false,
    terminalApp: 'auto',
    resolvedTerminalApp: null,
    terminalAvailable: false,
    terminalAppAvailability: { ghostty: false, terminal: false },
    editorApp: 'auto',
    resolvedEditorApp: null,
    editorAvailable: false,
    editorAppAvailability: { vscode: false, cursor: false, windsurf: false },
    externalAppsDetectedAt: 0,
    githubCliAvailable: false,
    githubCliVersion: null,
    githubCliHosts: {},
    bootSessionSnapshot: {
      openRepos: [],
      activeRepo: null,
      detailCollapsed: true,
      detailFocusMode: false,
      workspaceLayout: 'top-bottom',
      detailPaneSizes: { 'top-bottom': 0.5, 'left-right': 0.5 },
    },
  })
}

describe('settings store external app hydration', () => {
  beforeEach(() => {
    setRendererBridgeForTests(null)
    resetSettingsStore()
    FakeWebSocket.instances = []
  })

  afterEach(async () => {
    const { resetServerInvalidationIngressForTests } = await import('#/web/server-invalidation-ingress.ts')
    resetServerInvalidationIngressForTests()
  })

  test('ignores stale externalApps.get results after a newer refresh', async () => {
    const startup = deferred<{
      terminal: {
        pref: 'auto'
        resolved: 'terminal'
        available: true
        appAvailability: { ghostty: false; terminal: true }
        detectedAt: number
      }
      editor: {
        pref: 'auto'
        resolved: 'vscode'
        available: true
        appAvailability: { vscode: true; cursor: false; windsurf: false }
        detectedAt: number
      }
    }>()
    const refreshed = {
      terminal: {
        pref: 'auto' as const,
        resolved: 'ghostty' as const,
        available: true,
        appAvailability: { ghostty: true, terminal: true },
        detectedAt: 200,
      },
      editor: {
        pref: 'auto' as const,
        resolved: 'cursor' as const,
        available: true,
        appAvailability: { vscode: false, cursor: true, windsurf: false },
        detectedAt: 200,
      },
    }
    installBridge({
      'externalApps.get': () => startup.promise,
      'externalApps.refresh': () => refreshed,
    })

    const hydratePromise = useSettingsStore.getState().hydrateExternalApps()
    await Promise.resolve()
    await useSettingsStore.getState().refreshExternalApps()
    startup.resolve({
      terminal: {
        pref: 'auto',
        resolved: 'terminal',
        available: true,
        appAvailability: { ghostty: false, terminal: true },
        detectedAt: 100,
      },
      editor: {
        pref: 'auto',
        resolved: 'vscode',
        available: true,
        appAvailability: { vscode: true, cursor: false, windsurf: false },
        detectedAt: 100,
      },
    })
    await hydratePromise

    expect(useSettingsStore.getState()).toMatchObject({
      resolvedTerminalApp: 'ghostty',
      terminalAppAvailability: { ghostty: true, terminal: true },
      resolvedEditorApp: 'cursor',
      editorAppAvailability: { vscode: false, cursor: true, windsurf: false },
      externalAppsDetectedAt: 200,
    })
  })

  test('ignores stale external app events after a newer refresh', async () => {
    let externalAppsState = {
      terminal: {
        pref: 'auto',
        resolved: 'ghostty',
        available: true,
        appAvailability: { ghostty: true, terminal: true },
        detectedAt: 200,
      },
      editor: {
        pref: 'auto',
        resolved: 'cursor',
        available: true,
        appAvailability: { vscode: false, cursor: true, windsurf: false },
        detectedAt: 200,
      },
    }
    const bridge = installBridge({
      'settings.get': () => ({
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
        session: {
          openRepos: [],
          activeRepo: null,
          detailCollapsed: true,
          detailFocusMode: false,
          workspaceLayout: 'top-bottom',
          detailPaneSizes: { 'top-bottom': 0.5, 'left-right': 0.5 },
        },
        recentRepos: [],
      }),
      'githubCli.get': () => ({ available: false, version: null, detectedAt: 0, hosts: {} }),
      'externalApps.get': () => externalAppsState,
      'externalApps.refresh': () => ({
        terminal: {
          pref: 'auto',
          resolved: 'ghostty',
          available: true,
          appAvailability: { ghostty: true, terminal: true },
          detectedAt: 200,
        },
        editor: {
          pref: 'auto',
          resolved: 'cursor',
          available: true,
          appAvailability: { vscode: false, cursor: true, windsurf: false },
          detectedAt: 200,
        },
      }),
    })

    await useSettingsStore.getState().hydrate()
    await useSettingsStore.getState().refreshExternalApps()
    externalAppsState = {
      terminal: {
        pref: 'auto',
        resolved: 'terminal',
        available: true,
        appAvailability: { ghostty: false, terminal: true },
        detectedAt: 100,
      },
      editor: {
        pref: 'auto',
        resolved: 'vscode',
        available: true,
        appAvailability: { vscode: true, cursor: false, windsurf: false },
        detectedAt: 100,
      },
    }
    bridge.emit({
      type: 'settings-invalidated',
      scopes: ['external-apps'],
    })
    await Promise.resolve()

    expect(useSettingsStore.getState()).toMatchObject({
      resolvedTerminalApp: 'ghostty',
      terminalAppAvailability: { ghostty: true, terminal: true },
      externalAppsDetectedAt: 200,
    })
  })

  test('hydrates and updates terminal notification preference from settings events', async () => {
    let settingsState = {
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
      session: {
        openRepos: [],
        activeRepo: null,
        detailCollapsed: true,
        detailFocusMode: false,
        workspaceLayout: 'top-bottom',
        detailPaneSizes: { 'top-bottom': 0.5, 'left-right': 0.5 },
      },
      recentRepos: [],
    }
    const bridge = installBridge({
      'settings.get': () => settingsState,
      'githubCli.get': () => ({ available: false, version: null, detectedAt: 0, hosts: {} }),
    })

    await useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().terminalNotificationsEnabled).toBe(false)

    settingsState = { ...settingsState, terminalNotificationsEnabled: true }
    bridge.emit({ type: 'settings-invalidated', scopes: ['settings-snapshot'] })
    await vi.waitFor(() => {
      expect(useSettingsStore.getState().terminalNotificationsEnabled).toBe(true)
    })
  })

  test('consumeBootSessionSnapshot returns the hydrated session snapshot once and then clears it', async () => {
    installBridge({
      'settings.get': () => ({
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
        session: {
          openRepos: [{ kind: 'local', id: '/tmp/repo' }],
          activeRepo: '/tmp/repo',
          detailCollapsed: false,
          detailFocusMode: false,
          workspaceLayout: 'left-right',
          detailPaneSizes: { 'top-bottom': 0.5, 'left-right': 0.4 },
        },
        recentRepos: [],
      }),
      'githubCli.get': () => ({ available: false, version: null, detectedAt: 0, hosts: {} }),
    })

    await useSettingsStore.getState().hydrate()

    expect(useSettingsStore.getState().consumeBootSessionSnapshot()).toMatchObject({
      openRepos: [{ kind: 'local', id: '/tmp/repo' }],
      activeRepo: '/tmp/repo',
      workspaceLayout: 'left-right',
    })
    expect(useSettingsStore.getState().bootSessionSnapshot).toBeNull()
    expect(useSettingsStore.getState().consumeBootSessionSnapshot()).toMatchObject({
      openRepos: [],
      activeRepo: null,
      workspaceLayout: 'top-bottom',
    })
  })
})
