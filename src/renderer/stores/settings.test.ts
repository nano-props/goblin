import { beforeEach, describe, expect, test } from 'vitest'
import { useSettingsStore } from '#/renderer/stores/settings.ts'

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
      goblin: {
        homeDir: '/Users/test',
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
    },
  })
  return {
    emit(event: any) {
      for (const listener of listeners) listener(event)
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
    ghAvailable: false,
    ghVersion: null,
    terminalApp: 'auto',
    resolvedTerminalApp: null,
    terminalAvailable: false,
    terminalAppAvailability: { ghostty: false, terminal: false },
    editorApp: 'auto',
    resolvedEditorApp: null,
    editorAvailable: false,
    editorAppAvailability: { vscode: false, cursor: false, windsurf: false },
    externalAppsDetectedAt: 0,
    savedSession: {
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
    resetSettingsStore()
  })

  test('ignores stale externalApps.get results after a newer refresh', async () => {
    const startup = deferred<{
      gh: { available: boolean; version: string | null; detectedAt: number }
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
      gh: { available: true, version: 'gh version 2.80.0', detectedAt: 200 },
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
      gh: { available: false, version: null, detectedAt: 100 },
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
      ghAvailable: true,
      ghVersion: 'gh version 2.80.0',
      resolvedTerminalApp: 'ghostty',
      terminalAppAvailability: { ghostty: true, terminal: true },
      resolvedEditorApp: 'cursor',
      editorAppAvailability: { vscode: false, cursor: true, windsurf: false },
      externalAppsDetectedAt: 200,
    })
  })

  test('ignores stale external app events after a newer refresh', async () => {
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
      'externalApps.refresh': () => ({
        gh: { available: true, version: 'gh version 2.80.0', detectedAt: 200 },
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
    bridge.emit({
      type: 'terminal-app-changed',
      pref: 'auto',
      resolved: 'terminal',
      available: true,
      appAvailability: { ghostty: false, terminal: true },
      detectedAt: 100,
    })

    expect(useSettingsStore.getState()).toMatchObject({
      resolvedTerminalApp: 'ghostty',
      terminalAppAvailability: { ghostty: true, terminal: true },
      externalAppsDetectedAt: 200,
    })
  })

  test('hydrates and updates terminal notification preference from settings events', async () => {
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
    })

    await useSettingsStore.getState().hydrate()
    expect(useSettingsStore.getState().terminalNotificationsEnabled).toBe(false)

    bridge.emit({ type: 'terminal-notifications-changed', enabled: true })
    expect(useSettingsStore.getState().terminalNotificationsEnabled).toBe(true)
  })
})
