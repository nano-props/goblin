import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InitialSettingsSnapshot, RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'

describe('renderer bootstrap', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
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
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        goblin: {
          homeDir: bootstrap.homeDir,
          initialI18n: bootstrap.initialI18n,
          initialSettings: bootstrap.initialSettings,
        },
      },
    })

    const { getInitialBootstrap } = await import('#/renderer/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual(bootstrap)
  })

  test('falls back when the goblin bridge is unavailable', async () => {
    const { getInitialBootstrap } = await import('#/renderer/bootstrap.ts')
    expect(getInitialBootstrap()).toEqual({
      homeDir: '',
      initialI18n: null,
      initialSettings: null,
    })
  })
})
