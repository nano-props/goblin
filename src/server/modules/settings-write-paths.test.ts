import { beforeEach, describe, expect, test, vi } from 'vitest'
import { resolveI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const mocks = vi.hoisted(() => ({
  publishSettingsInvalidation: vi.fn(),
  addServerRecentWorkspace: vi.fn(),
  clearServerRecentWorkspaces: vi.fn(),
  setServerFetchIntervalSec: vi.fn(),
  updateUserSettings: vi.fn(),
  settingsInvalidationScopesForPrefsPatch: vi.fn(),
}))

vi.mock('#/server/modules/invalidation-broker.ts', () => ({
  publishSettingsInvalidation: mocks.publishSettingsInvalidation,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  addServerRecentWorkspace: mocks.addServerRecentWorkspace,
  clearServerRecentWorkspaces: mocks.clearServerRecentWorkspaces,
  setServerFetchIntervalSec: mocks.setServerFetchIntervalSec,
  updateUserSettings: mocks.updateUserSettings,
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

describe('settings command handlers', () => {
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
      globalShortcut: 'CommandOrControl+Shift+G',
      lanEnabled: false,
    } as const
    const i18nSnapshot = resolveI18nSnapshot('ja', 'ja-JP,ja;q=0.9,en;q=0.8')
    mocks.updateUserSettings.mockResolvedValue(updatedSettings)
    mocks.settingsInvalidationScopesForPrefsPatch.mockReturnValue(['i18n'])
    const { handleUpdateUserSettings } = await import('#/server/modules/settings-write-paths.ts')

    await expect(
      handleUpdateUserSettings(
        { prefs: { lang: 'ja' } },
        { acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8', signal: new AbortController().signal },
      ),
    ).resolves.toEqual({
      ok: true,
      prefs: updatedSettings,
      i18n: i18nSnapshot,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['i18n'])
  })

  test('adds recent repos and publishes settings snapshot invalidation', async () => {
    const repo = { id: workspaceIdForTest('goblin+file:///tmp/repo-a') }
    mocks.addServerRecentWorkspace.mockResolvedValue([repo])
    const { handleAddRecentWorkspace } = await import('#/server/modules/settings-write-paths.ts')

    await expect(handleAddRecentWorkspace({ workspace: repo })).resolves.toEqual({
      ok: true,
      recentWorkspaces: [repo],
      addedWorkspace: repo,
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('schema rejects malformed fetch interval at the perimeter', async () => {
    const { SETTINGS_PROCEDURE_SCHEMAS } = await import('#/shared/procedure-schemas.ts')
    const { parseHttpInput } = await import('#/server/common/http-validate.ts')
    expect(() => parseHttpInput(SETTINGS_PROCEDURE_SCHEMAS.fetchInterval, { sec: '5m' })).toThrow()
  })
})
