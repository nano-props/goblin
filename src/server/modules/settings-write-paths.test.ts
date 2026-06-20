import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SessionState } from '#/shared/api-types.ts'
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
        appAvailability: { ghostty: true, terminal: false, windowsTerminal: false },
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
    const session: SessionState = {
      openRepos: [],
      activeRepo: null,
      workspaceFocused: true,
      workspacePaneSizes: {
        'left-right': 50,
      },
      selectedTerminalByWorktree: {},
    }
    mocks.setServerSessionState.mockResolvedValue(session)
    mocks.setServerSessionState.mockResolvedValue(session as SessionState)
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

  test('schema rejects malformed fetch interval at the perimeter', async () => {
    const { SETTINGS_PROCEDURE_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    expect(() => parseHttpInput(SETTINGS_PROCEDURE_SCHEMAS.fetchInterval, { sec: '5m' })).toThrow()
  })

  test('schema accepts well-formed session state via the perimeter', async () => {
    const { SETTINGS_PATCH_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    const parsed = parseHttpInput(SETTINGS_PATCH_SCHEMAS.session, {
      session: {
        openRepos: [],
        activeRepo: null,
        workspaceFocused: true,
        workspacePaneSizes: { 'left-right': 61.8 },
      },
    })
    expect(parsed.session.workspaceFocused).toBe(true)
    expect(parsed.session.workspacePaneSizes).toEqual({ 'left-right': 61.8 })
  })
})
