import { afterEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  getServerRecentWorkspaces: vi.fn(),
  getServerWorkspaceSettings: vi.fn(),
}))

vi.mock('#/server/settings/source.ts', () => ({
  getUserSettings: mocks.getUserSettings,
  getServerRecentWorkspaces: mocks.getServerRecentWorkspaces,
  getServerWorkspaceSettings: mocks.getServerWorkspaceSettings,
}))

describe('server settings snapshot runtime state', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  test('combines server preferences, recent workspaces, and workspace settings', async () => {
    const prefs = {
      lang: 'auto' as const,
      theme: 'dark' as const,
      colorTheme: 'macos' as const,
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
    }
    mocks.getUserSettings.mockResolvedValue(prefs)
    mocks.getServerRecentWorkspaces.mockResolvedValue([])
    mocks.getServerWorkspaceSettings.mockResolvedValue([])

    const snapshotMod = await import('#/server/settings/snapshot.ts')
    await expect(snapshotMod.getSettingsSnapshot()).resolves.toEqual({
      ...prefs,
      recentWorkspaces: [],
      workspaceSettings: [],
    })
  })
})
