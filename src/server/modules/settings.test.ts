import { afterEach, describe, expect, test, vi } from 'vitest'
import { defaultSessionState } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => ({
  getServerSettingsPrefs: vi.fn(),
  getServerSessionState: vi.fn(),
  getServerRecentRepos: vi.fn(),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
  getServerSessionState: mocks.getServerSessionState,
  getServerRecentRepos: mocks.getServerRecentRepos,
}))

describe('server settings snapshot runtime state', () => {
  afterEach(async () => {
    const mod = await import('#/server/modules/settings.ts')
    mod.resetServerSettingsRuntimeForTests()
    vi.clearAllMocks()
    vi.resetModules()
  })

  test('reports the mirrored global shortcut registration state', async () => {
    mocks.getServerSettingsPrefs.mockResolvedValue({
      lang: 'auto',
      theme: 'dark',
      colorTheme: 'macos',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'Alt+G',
      terminalApp: 'auto',
      editorApp: 'auto',
    })
    mocks.getServerSessionState.mockResolvedValue({ ...defaultSessionState(), detailCollapsed: false })
    mocks.getServerRecentRepos.mockResolvedValue([])

    const mod = await import('#/server/modules/settings.ts')
    mod.setServerGlobalShortcutRegistered(true)

    await expect(mod.getSettingsSnapshot()).resolves.toMatchObject({
      globalShortcut: 'Alt+G',
      globalShortcutRegistered: true,
    })
  })
})
