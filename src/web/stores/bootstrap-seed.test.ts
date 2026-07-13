import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { I18nSnapshot } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

function installBridge() {
  // The bootstrap is now just the Electron preload's IPC seed
  // (homeDir, platform, initialServer). i18n and settings are
  // fetched on boot from `/api/settings/*` — they no longer live
  // on the bootstrap. We set `__GOBLIN_BOOTSTRAP__` for state and
  // a minimal `goblinNative` to satisfy the bridge detection.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
        initialServer: null,
      },
      goblinNative: {
        invokeIpc: vi.fn(),
        abortIpc: vi.fn(() => Promise.resolve(false)),
        onEvent: vi.fn(() => () => {}),
        pathForFile: vi.fn(() => ''),
      },
    },
  })
}

describe('client bootstrap seeding', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('i18n store starts empty and waits for the entrypoint hydrate from /api/i18n', async () => {
    installBridge()
    const { useI18nStore } = await import('#/web/stores/i18n.ts')

    // The store used to read `initialI18n` from the bootstrap and
    // seed itself synchronously. The server no longer inlines i18n
    // into HTML, so the store always starts with the default
    // English / auto / empty-dict placeholder. The app entrypoint
    // calls `hydrate()` before mounting the normal React tree.
    expect(useI18nStore.getState()).toMatchObject({
      lang: 'en',
      pref: 'auto',
      dict: {},
    })
  })

  test('setPref updates the dictionary from a snapshot returned by /api/i18n', async () => {
    installBridge()
    // `commitSnapshotNow` writes the active language to the html
    // element so screen readers and CSS `:lang()` selectors pick up
    // the new value. Stand up a stub before the store module loads.
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
    const { primaryWindowQueryClient } = await import('#/web/primary-window-queries.ts')
    const { settingsSnapshotQueryKey } = await import('#/web/settings-query-cache.ts')
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ lang: 'auto' }))

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
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({ lang: 'zh' })
  })
})
