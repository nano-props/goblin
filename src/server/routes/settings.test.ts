import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  publishSettingsInvalidation: vi.fn(),
  buildServerExternalAppsSnapshot: vi.fn(),
  getServerExternalAppsSnapshot: vi.fn(),
  getServerGitHubCliState: vi.fn(),
  buildServerI18nPayload: vi.fn(),
  getServerI18nPayload: vi.fn(),
  getSettingsSnapshot: vi.fn(),
  setServerGlobalShortcutRegistered: vi.fn(),
  addServerRecentRepo: vi.fn(),
  clearServerRecentRepos: vi.fn(),
  getServerSettingsPrefs: vi.fn(),
  setServerFetchIntervalSec: vi.fn(),
  setServerSessionState: vi.fn(),
  updateServerSettingsPrefs: vi.fn(),
  settingsInvalidationScopesForPrefsPatch: vi.fn(),
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishSettingsInvalidation: mocks.publishSettingsInvalidation,
}))

vi.mock('#/server/modules/external-apps.ts', () => ({
  buildServerExternalAppsSnapshot: mocks.buildServerExternalAppsSnapshot,
  getServerExternalAppsSnapshot: mocks.getServerExternalAppsSnapshot,
}))

vi.mock('#/server/modules/github-cli.ts', () => ({
  getServerGitHubCliState: mocks.getServerGitHubCliState,
}))

vi.mock('#/server/modules/i18n.ts', () => ({
  buildServerI18nPayload: mocks.buildServerI18nPayload,
  getServerI18nPayload: mocks.getServerI18nPayload,
}))

vi.mock('#/server/modules/settings.ts', () => ({
  getSettingsSnapshot: mocks.getSettingsSnapshot,
  setServerGlobalShortcutRegistered: mocks.setServerGlobalShortcutRegistered,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  addServerRecentRepo: mocks.addServerRecentRepo,
  clearServerRecentRepos: mocks.clearServerRecentRepos,
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
  setServerFetchIntervalSec: mocks.setServerFetchIntervalSec,
  setServerSessionState: mocks.setServerSessionState,
  updateServerSettingsPrefs: mocks.updateServerSettingsPrefs,
}))

vi.mock('#/shared/server-invalidation.ts', async () => {
  const actual = await vi.importActual<typeof import('#/shared/server-invalidation.ts')>('#/shared/server-invalidation.ts')
  return {
    ...actual,
    settingsInvalidationScopesForPrefsPatch: mocks.settingsInvalidationScopesForPrefsPatch,
  }
})

describe('settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns authoritative i18n payload together with updated prefs for language writes', async () => {
    const updatedSettings = {
      lang: 'ja',
      theme: 'auto',
      colorTheme: 'macos',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      terminalApp: 'auto',
      editorApp: 'auto',
      lanEnabled: false,
    } as const
    const i18nPayload = { lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } } as const

    mocks.updateServerSettingsPrefs.mockResolvedValue(updatedSettings)
    mocks.settingsInvalidationScopesForPrefsPatch.mockReturnValue(['i18n'])
    mocks.buildServerI18nPayload.mockReturnValue(i18nPayload)

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes()
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
        },
        body: JSON.stringify({ settings: { lang: 'ja' } }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      settings: updatedSettings,
      i18n: i18nPayload,
    })
    expect(mocks.buildServerI18nPayload).toHaveBeenCalledWith(updatedSettings, 'ja-JP,ja;q=0.9,en;q=0.8')
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['i18n'])
  })

  test('returns authoritative external apps snapshot together with updated prefs for app writes', async () => {
    const updatedSettings = {
      lang: 'auto',
      theme: 'auto',
      colorTheme: 'macos',
      fetchIntervalSec: 120,
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      swapCloseShortcuts: false,
      toggleDetailOnActionBarBlankClick: false,
      globalShortcut: 'CommandOrControl+Shift+G',
      terminalApp: 'ghostty',
      editorApp: 'cursor',
      lanEnabled: false,
    } as const
    const externalApps = {
      terminal: {
        pref: 'ghostty',
        resolved: 'ghostty',
        available: true,
        appAvailability: { ghostty: true, terminal: false },
        detectedAt: 1,
      },
      editor: {
        pref: 'cursor',
        resolved: 'cursor',
        available: true,
        appAvailability: { vscode: true, cursor: true, windsurf: false },
        detectedAt: 1,
      },
    } as const

    mocks.updateServerSettingsPrefs.mockResolvedValue(updatedSettings)
    mocks.settingsInvalidationScopesForPrefsPatch.mockReturnValue(['external-apps', 'settings-snapshot'])
    mocks.buildServerExternalAppsSnapshot.mockResolvedValue(externalApps)

    const { createSettingsRoutes } = await import('#/server/routes/settings.ts')
    const app = createSettingsRoutes()
    const response = await app.request(
      new Request('http://127.0.0.1:32100/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: { terminalApp: 'ghostty' } }),
      }),
    )

    await expect(response.json()).resolves.toEqual({
      ok: true,
      settings: updatedSettings,
      externalApps,
    })
    expect(mocks.buildServerExternalAppsSnapshot).toHaveBeenCalledWith(updatedSettings, expect.any(AbortSignal))
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['external-apps', 'settings-snapshot'])
  })
})
