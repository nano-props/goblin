import { beforeEach, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { nativeSettingsProjectionStateFromSettings } from '#/shared/native-host-projection.ts'

const mocks = vi.hoisted(() => ({
  setGlobalShortcutState: vi.fn(async () => true),
  syncGlobalShortcuts: vi.fn(() => true),
}))

vi.mock('#/main/settings-server-client.ts', () => ({
  setGlobalShortcutState: mocks.setGlobalShortcutState,
}))
vi.mock('#/main/shortcuts.ts', () => ({
  syncGlobalShortcuts: mocks.syncGlobalShortcuts,
}))
vi.mock('#/main/i18n/index.ts', () => ({ resolveLang: vi.fn(), setCurrentLang: vi.fn() }))
vi.mock('#/main/menu.ts', () => ({ buildAppMenu: vi.fn() }))
vi.mock('#/main/menu-state.ts', () => ({ applyMenuRuntimeState: vi.fn() }))
vi.mock('#/main/recent-workspaces.ts', () => ({ syncRecentWorkspaces: vi.fn() }))
vi.mock('#/main/theme.ts', () => ({ applyThemeSettingsProjection: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.syncGlobalShortcuts.mockReturnValue(true)
})

test('reports an incomplete shortcut projection when registration status persistence fails', async () => {
  const settings = defaultSettingsSnapshot({ globalShortcut: 'Alt+K' })
  mocks.setGlobalShortcutState.mockRejectedValueOnce(new Error('settings unavailable'))
  const { applyNativeHostProjection } = await import('#/main/native-host-settings-effects.ts')

  await expect(
    applyNativeHostProjection({
      prefs: {
        patch: { globalShortcut: 'Alt+K' },
        settings: nativeSettingsProjectionStateFromSettings(settings),
      },
    }),
  ).rejects.toThrow('settings unavailable')

  expect(mocks.syncGlobalShortcuts).toHaveBeenCalledWith(false, 'Alt+K')
  expect(mocks.setGlobalShortcutState).toHaveBeenCalledWith(true)
})
