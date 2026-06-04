import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InitialI18nSnapshot, InitialSettingsSnapshot } from '#/shared/bootstrap.ts'
function installBridge(
  overrides: {
    initialI18n?: InitialI18nSnapshot | null
    initialSettings?: InitialSettingsSnapshot | null
  } = {},
) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblinNative: {
        homeDir: '/Users/test',
        initialI18n: overrides.initialI18n ?? null,
        initialSettings: overrides.initialSettings ?? null,
        invokeRpc: vi.fn(),
        abortRpc: vi.fn(() => Promise.resolve(false)),
        onEvent: vi.fn(() => () => {}),
        pathForFile: vi.fn(() => ''),
      },
    },
  })
}

describe('renderer bootstrap seeding', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('seeds settings store from preload bootstrap including editorApp', async () => {
    installBridge({
      initialSettings: {
        fetchIntervalSec: 300,
        terminalNotificationsEnabled: true,
        shortcutsDisabled: true,
        globalShortcutDisabled: true,
        swapCloseShortcuts: true,
        toggleDetailOnActionBarBlankClick: true,
        globalShortcut: 'CommandOrControl+Alt+G',
        globalShortcutRegistered: true,
        terminalApp: 'ghostty',
        editorApp: 'cursor',
      },
    })

    const { useSettingsStore } = await import('#/web/stores/settings.ts')

    expect(useSettingsStore.getState()).toMatchObject({
      fetchIntervalSec: 300,
      terminalNotificationsEnabled: true,
      shortcutsDisabled: true,
      globalShortcutDisabled: true,
      swapCloseShortcuts: true,
      toggleDetailOnActionBarBlankClick: true,
      globalShortcut: 'CommandOrControl+Alt+G',
      globalShortcutRegistered: true,
      terminalApp: 'ghostty',
      editorApp: 'cursor',
    })
  })

  test('seeds i18n store from preload bootstrap including pref', async () => {
    installBridge({
      initialI18n: {
        lang: 'ja',
        pref: 'ja',
        dict: { 'settings.title': '設定' },
      },
    })

    const { useI18nStore } = await import('#/web/stores/i18n.ts')

    expect(useI18nStore.getState()).toMatchObject({
      lang: 'ja',
      pref: 'ja',
      dict: { 'settings.title': '設定' },
    })
  })
})
