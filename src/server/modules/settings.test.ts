import { afterEach, describe, expect, test, vi } from 'vitest'
import { createNativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'

const mocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  getServerRecentWorkspaces: vi.fn(),
  getServerRepoSettings: vi.fn(),
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getUserSettings: mocks.getUserSettings,
  getServerRecentWorkspaces: mocks.getServerRecentWorkspaces,
  getServerRepoSettings: mocks.getServerRepoSettings,
}))

describe('server settings snapshot runtime state', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  test('reports the mirrored global shortcut registration state', async () => {
    mocks.getUserSettings.mockResolvedValue({
      lang: 'auto',
      theme: 'dark',
      colorTheme: 'macos',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      globalShortcut: 'Alt+G',
      lanEnabled: false,
    })
    mocks.getServerRecentWorkspaces.mockResolvedValue([])
    mocks.getServerRepoSettings.mockResolvedValue([])

    const state = createNativeShortcutRegistrationState()
    state.globalShortcutRegistered = true

    const snapshotMod = await import('#/server/modules/settings-snapshot.ts')
    await expect(snapshotMod.getSettingsSnapshot(state)).resolves.toMatchObject({
      globalShortcut: 'Alt+G',
      globalShortcutRegistered: true,
    })
  })
})
