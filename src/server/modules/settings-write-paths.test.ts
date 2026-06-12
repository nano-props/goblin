import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'

const mocks = vi.hoisted(() => ({
  publishSettingsInvalidation: vi.fn(),
  buildServerExternalAppsSnapshot: vi.fn(),
  addServerRecentRepo: vi.fn(),
  clearServerRecentRepos: vi.fn(),
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
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  addServerRecentRepo: mocks.addServerRecentRepo,
  clearServerRecentRepos: mocks.clearServerRecentRepos,
  setServerFetchIntervalSec: mocks.setServerFetchIntervalSec,
  setServerSessionState: mocks.setServerSessionState,
  updateServerSettingsPrefs: mocks.updateServerSettingsPrefs,
}))

vi.mock('#/shared/server-invalidation.ts', async () => {
  const actual = await vi.importActual<typeof import('#/shared/server-invalidation.ts')>(
    '#/shared/server-invalidation.ts',
  )
  return {
    ...actual,
    settingsInvalidationScopesForPrefsPatch: mocks.settingsInvalidationScopesForPrefsPatch,
  }
})

describe('settings write paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns authoritative i18n snapshot together with updated prefs for language writes', async () => {
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
    const i18nSnapshot = resolveI18nSnapshot('ja', 'ja-JP,ja;q=0.9,en;q=0.8')
    mocks.updateServerSettingsPrefs.mockResolvedValue(updatedSettings)
    mocks.settingsInvalidationScopesForPrefsPatch.mockReturnValue(['i18n'])
    const { applyServerSettingsPrefsWrite } = await import('#/server/modules/settings-write-paths.ts')

    await expect(
      applyServerSettingsPrefsWrite(
        { settings: { lang: 'ja' } },
        { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: new AbortController().signal },
      ),
    ).resolves.toEqual({
      ok: true,
      settings: updatedSettings,
      i18n: i18nSnapshot,
    })
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
    const { applyServerSettingsPrefsWrite } = await import('#/server/modules/settings-write-paths.ts')

    await expect(
      applyServerSettingsPrefsWrite(
        { settings: { terminalApp: 'ghostty' } },
        { acceptLanguage: undefined, signal: new AbortController().signal },
      ),
    ).resolves.toEqual({
      ok: true,
      settings: updatedSettings,
      externalApps,
    })
    expect(mocks.buildServerExternalAppsSnapshot).toHaveBeenCalledWith(updatedSettings, expect.any(AbortSignal))
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['external-apps', 'settings-snapshot'])
  })

  test('persists session state without publishing settings invalidation', async () => {
    const session = {
      openRepos: [],
      activeRepo: null,
      detailCollapsed: true,
      detailFocusMode: false,
      workspaceLayout: 'top-bottom',
      detailPaneSizes: {
        'top-bottom': 40,
        'left-right': 50,
      },
      selectedTerminalByWorktree: {},
    } as const
    mocks.setServerSessionState.mockResolvedValue(session)
    const { applyServerSessionWrite } = await import('#/server/modules/settings-write-paths.ts')

    await expect(applyServerSessionWrite({ session })).resolves.toEqual({
      ok: true,
      session,
    })
    expect(mocks.setServerSessionState).toHaveBeenCalledWith(session)
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('adds recent repos and publishes settings snapshot invalidation', async () => {
    const repo = { kind: 'local', id: '/tmp/repo-a' } as const
    mocks.addServerRecentRepo.mockResolvedValue([repo])
    const { applyServerRecentRepoAddWrite } = await import('#/server/modules/settings-write-paths.ts')

    await expect(applyServerRecentRepoAddWrite({ repo })).resolves.toEqual({
      ok: true,
      recentRepos: [repo],
      addedRepo: repo,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })
})
