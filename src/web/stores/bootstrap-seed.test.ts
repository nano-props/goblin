import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InitialSettingsSnapshot } from '#/shared/bootstrap.ts'
import type { I18nSnapshot } from '#/shared/api-types.ts'
function installBridge(
  overrides: {
    initialI18n?: I18nSnapshot | null
    initialSettings?: InitialSettingsSnapshot | null
  } = {},
) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblinNative: {
        homeDir: '/Users/test',
        platform: 'darwin',
        initialI18n: overrides.initialI18n ?? null,
        initialSettings: overrides.initialSettings ?? null,
        invokeIpc: vi.fn(),
        abortIpc: vi.fn(() => Promise.resolve(false)),
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

  test('settings store no longer mirrors preload settings payload', async () => {
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
        lanEnabled: false,
      },
    })

    const { useSessionRestoreStore } = await import('#/web/stores/session-restore.ts')

    expect(useSessionRestoreStore.getState()).toMatchObject({ bootSessionSnapshot: null })
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

  test('switches away from and back to a frozen initial dictionary without mutating shared objects', async () => {
    installBridge({
      initialI18n: {
        lang: 'zh',
        pref: 'auto',
        dict: Object.freeze({ hello: '你好' }),
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        documentElement: {
          setAttribute: vi.fn(),
          getAttribute: vi.fn(() => null),
        },
      },
    })
    let nextSnapshot: I18nSnapshot = Object.freeze({
      lang: 'en',
      pref: 'en',
      dict: Object.freeze({ hello: 'hello' }),
    })
    vi.doMock('#/web/settings-client.ts', () => ({
      getI18nSnapshot: vi.fn(async () => nextSnapshot),
      setI18nPref: vi.fn(async () => nextSnapshot),
    }))

    const { useI18nStore } = await import('#/web/stores/i18n.ts')

    await expect(useI18nStore.getState().setPref('en')).resolves.toBeUndefined()
    expect(useI18nStore.getState()).toMatchObject({
      lang: 'en',
      pref: 'en',
      dict: { hello: 'hello' },
    })

    nextSnapshot = Object.freeze({
      lang: 'zh',
      pref: 'zh',
      dict: Object.freeze({ hello: '你好' }),
    })
    await expect(useI18nStore.getState().setPref('zh')).resolves.toBeUndefined()
    expect(useI18nStore.getState()).toMatchObject({
      lang: 'zh',
      pref: 'zh',
      dict: { hello: '你好' },
    })
  })
})
