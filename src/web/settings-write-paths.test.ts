// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot, defaultSessionState } from '#/shared/settings-defaults.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { externalAppsQueryKey, githubCliQueryKey, lanInfoQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { GitHubCliState } from '#/shared/rpc.ts'

type AddRecentRepoResult = {
  recentRepos: RepoSessionEntry[]
  addedRepo: RepoSessionEntry | null
}

const appDataClientMocks = vi.hoisted(() => ({
  addRecentRepo: vi.fn<() => Promise<AddRecentRepoResult>>(async () => ({ recentRepos: [], addedRepo: null })),
  clearRecentRepos: vi.fn(async () => {}),
  refreshExternalAppsSnapshot: vi.fn(async () => ({
    terminal: { pref: 'auto', resolved: null, available: false, appAvailability: { ghostty: false, terminal: false }, detectedAt: 0 },
    editor: { pref: 'auto', resolved: null, available: false, appAvailability: { vscode: false, cursor: false, windsurf: false }, detectedAt: 0 },
  })),
  refreshGitHubCliState: vi.fn<() => Promise<GitHubCliState>>(async () => ({
    available: false,
    version: null,
    detectedAt: 0,
    hosts: {},
  })),
  saveSession: vi.fn(async (session) => session),
  setGlobalShortcut: vi.fn(async (accelerator) => ({ accelerator, registered: true })),
  setGlobalShortcutDisabled: vi.fn(async () => {}),
  setLanEnabled: vi.fn(async () => {}),
  setPreferredEditorApp: vi.fn(async (pref) => ({
    pref,
    resolved: null,
    available: false,
    appAvailability: { vscode: false, cursor: false, windsurf: false },
    detectedAt: 0,
  })),
  setPreferredTerminalApp: vi.fn(async (pref) => ({
    pref,
    resolved: null,
    available: false,
    appAvailability: { ghostty: false, terminal: false },
    detectedAt: 0,
  })),
  setSettingsFetchInterval: vi.fn(async (sec) => sec),
  setShortcutsDisabled: vi.fn(async () => {}),
  setSwapCloseShortcuts: vi.fn(async () => {}),
  setTerminalNotificationsEnabled: vi.fn(async () => {}),
  setToggleDetailOnActionBarBlankClick: vi.fn(async () => {}),
}))

vi.mock('#/web/settings-client.ts', () => ({
  addRecentRepo: appDataClientMocks.addRecentRepo,
  clearRecentRepos: appDataClientMocks.clearRecentRepos,
  refreshExternalAppsSnapshot: appDataClientMocks.refreshExternalAppsSnapshot,
  refreshGitHubCliState: appDataClientMocks.refreshGitHubCliState,
  saveSession: appDataClientMocks.saveSession,
  setGlobalShortcut: appDataClientMocks.setGlobalShortcut,
  setGlobalShortcutDisabled: appDataClientMocks.setGlobalShortcutDisabled,
  setLanEnabled: appDataClientMocks.setLanEnabled,
  setPreferredEditorApp: appDataClientMocks.setPreferredEditorApp,
  setPreferredTerminalApp: appDataClientMocks.setPreferredTerminalApp,
  setSettingsFetchInterval: appDataClientMocks.setSettingsFetchInterval,
  setShortcutsDisabled: appDataClientMocks.setShortcutsDisabled,
  setSwapCloseShortcuts: appDataClientMocks.setSwapCloseShortcuts,
  setTerminalNotificationsEnabled: appDataClientMocks.setTerminalNotificationsEnabled,
  setToggleDetailOnActionBarBlankClick: appDataClientMocks.setToggleDetailOnActionBarBlankClick,
}))

describe('settings write paths', () => {
  beforeEach(() => {
    mainWindowQueryClient.clear()
    appDataClientMocks.addRecentRepo.mockReset()
    appDataClientMocks.addRecentRepo.mockResolvedValue({ recentRepos: [], addedRepo: null })
    appDataClientMocks.clearRecentRepos.mockReset()
    appDataClientMocks.clearRecentRepos.mockResolvedValue(undefined)
    appDataClientMocks.refreshExternalAppsSnapshot.mockReset()
    appDataClientMocks.refreshExternalAppsSnapshot.mockResolvedValue({
      terminal: { pref: 'auto', resolved: null, available: false, appAvailability: { ghostty: false, terminal: false }, detectedAt: 0 },
      editor: { pref: 'auto', resolved: null, available: false, appAvailability: { vscode: false, cursor: false, windsurf: false }, detectedAt: 0 },
    })
    appDataClientMocks.refreshGitHubCliState.mockReset()
    appDataClientMocks.refreshGitHubCliState.mockResolvedValue({ available: false, version: null, detectedAt: 0, hosts: {} })
    appDataClientMocks.saveSession.mockReset()
    appDataClientMocks.saveSession.mockImplementation(async (session) => session)
    appDataClientMocks.setGlobalShortcut.mockReset()
    appDataClientMocks.setGlobalShortcut.mockImplementation(async (accelerator) => ({ accelerator, registered: true }))
    appDataClientMocks.setGlobalShortcutDisabled.mockReset()
    appDataClientMocks.setGlobalShortcutDisabled.mockResolvedValue(undefined)
    appDataClientMocks.setLanEnabled.mockReset()
    appDataClientMocks.setLanEnabled.mockResolvedValue(undefined)
    appDataClientMocks.setPreferredEditorApp.mockReset()
    appDataClientMocks.setPreferredEditorApp.mockImplementation(async (pref) => ({
      pref,
      resolved: null,
      available: false,
      appAvailability: { vscode: false, cursor: false, windsurf: false },
      detectedAt: 0,
    }))
    appDataClientMocks.setPreferredTerminalApp.mockReset()
    appDataClientMocks.setPreferredTerminalApp.mockImplementation(async (pref) => ({
      pref,
      resolved: null,
      available: false,
      appAvailability: { ghostty: false, terminal: false },
      detectedAt: 0,
    }))
    appDataClientMocks.setSettingsFetchInterval.mockReset()
    appDataClientMocks.setSettingsFetchInterval.mockImplementation(async (sec) => sec)
    appDataClientMocks.setShortcutsDisabled.mockReset()
    appDataClientMocks.setShortcutsDisabled.mockResolvedValue(undefined)
    appDataClientMocks.setSwapCloseShortcuts.mockReset()
    appDataClientMocks.setSwapCloseShortcuts.mockResolvedValue(undefined)
    appDataClientMocks.setTerminalNotificationsEnabled.mockReset()
    appDataClientMocks.setTerminalNotificationsEnabled.mockResolvedValue(undefined)
    appDataClientMocks.setToggleDetailOnActionBarBlankClick.mockReset()
    appDataClientMocks.setToggleDetailOnActionBarBlankClick.mockResolvedValue(undefined)
  })

  test('recordRecentRepo syncs recent repos into the settings snapshot cache', async () => {
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    appDataClientMocks.addRecentRepo.mockResolvedValue({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
      addedRepo: { kind: 'local', id: '/tmp/repo-a' },
    })
    const { recordRecentRepo } = await import('#/web/settings-write-paths.ts')

    await recordRecentRepo({ kind: 'local', id: '/tmp/repo-a' })

    expect(mainWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
    })
  })

  test('clearRecentRepoHistory clears recent repos from the settings snapshot cache', async () => {
    mainWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }] }),
    )
    const { clearRecentRepoHistory } = await import('#/web/settings-write-paths.ts')

    await clearRecentRepoHistory()

    expect(mainWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentRepos: [],
    })
  })

  test('persistSessionState syncs the saved session into the settings snapshot cache', async () => {
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const session = {
      ...defaultSessionState(),
      openRepos: [{ kind: 'local' as const, id: '/tmp/repo-a' }],
      activeRepo: '/tmp/repo-a',
    }
    appDataClientMocks.saveSession.mockResolvedValue(session)
    const { persistSessionState } = await import('#/web/settings-write-paths.ts')

    await persistSessionState(session)

    expect(mainWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      session,
    })
  })

  test('setTerminalAppPreference updates both external apps and runtime settings caches', async () => {
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    mainWindowQueryClient.setQueryData(externalAppsQueryKey(), {
      terminal: { pref: 'auto', resolved: null, available: false, appAvailability: { ghostty: false, terminal: false }, detectedAt: 0 },
      editor: { pref: 'auto', resolved: null, available: false, appAvailability: { vscode: false, cursor: false, windsurf: false }, detectedAt: 0 },
    })
    const { setTerminalAppPreference } = await import('#/web/settings-write-paths.ts')

    await setTerminalAppPreference('ghostty')

    expect(mainWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({ terminalApp: 'ghostty' })
    expect(mainWindowQueryClient.getQueryData(externalAppsQueryKey())).toMatchObject({
      terminal: expect.objectContaining({ pref: 'ghostty' }),
    })
  })

  test('refreshGitHubCliDetection writes refreshed state into the GitHub CLI cache', async () => {
    appDataClientMocks.refreshGitHubCliState.mockResolvedValue({
      available: true,
      version: '2.70.0',
      detectedAt: 1,
      hosts: {
        'github.com': {
          host: 'github.com',
          authenticated: true,
          activeLogin: 'octocat',
          logins: ['octocat'],
          tokenSource: 'keychain',
        },
      },
    })
    const { refreshGitHubCliDetection } = await import('#/web/settings-write-paths.ts')

    await refreshGitHubCliDetection()

    expect(mainWindowQueryClient.getQueryData(githubCliQueryKey())).toMatchObject({
      available: true,
      version: '2.70.0',
    })
  })

  test('setLanEnabledPreference updates runtime settings cache and invalidates LAN info', async () => {
    const invalidateSpy = vi.spyOn(mainWindowQueryClient, 'invalidateQueries')
    mainWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const { setLanEnabledPreference } = await import('#/web/settings-write-paths.ts')

    await setLanEnabledPreference(true)

    expect(mainWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({ lanEnabled: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: lanInfoQueryKey() })
    invalidateSpy.mockRestore()
  })
})
