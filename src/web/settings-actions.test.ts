// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsSnapshot, defaultWorkspaceSessionState } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { githubCliQueryKey, lanInfoQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { GitHubCliState, RepoSettingsState } from '#/shared/api-types.ts'

type AddRecentRepoResult = {
  recentRepos: RepoSessionEntry[]
  addedRepo: RepoSessionEntry | null
}

const appDataClientMocks = vi.hoisted(() => ({
  addRecentRepo: vi.fn<() => Promise<AddRecentRepoResult>>(async () => ({ recentRepos: [], addedRepo: null })),
  clearRecentRepos: vi.fn(async () => {}),
  getSettingsSnapshot: vi.fn(),
  refreshExternalAppsSnapshot: vi.fn(async () => ({
    terminal: {
      available: false,
      appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
      detectedAt: 0,
    },
    editor: {
      available: false,
      appAvailability: { vscode: false },
      detectedAt: 0,
    },
  })),
  refreshGitHubCliState: vi.fn<() => Promise<GitHubCliState>>(async () => ({
    available: false,
    version: null,
    detectedAt: 0,
    hosts: {},
  })),
  saveSession: vi.fn(async (session) => session),
  setGlobalShortcut: vi.fn(async (accelerator) => ({ accelerator, registered: true })),
  setGlobalShortcutDisabled: vi.fn(async (disabled) => disabled),
  setLanEnabled: vi.fn(async (enabled) => enabled),
  setRecentWorkspaceExternalApp: vi.fn<() => Promise<RepoSettingsState>>(async () => ({ repoSettings: [] })),
  setSettingsFetchInterval: vi.fn(async (sec) => sec),
  setShortcutsDisabled: vi.fn(async (disabled) => disabled),
  setTerminalNotificationsEnabled: vi.fn(async (enabled) => enabled),
}))

vi.mock('#/web/settings-client.ts', () => ({
  addRecentRepo: appDataClientMocks.addRecentRepo,
  clearRecentRepos: appDataClientMocks.clearRecentRepos,
  getSettingsSnapshot: appDataClientMocks.getSettingsSnapshot,
  refreshExternalAppsSnapshot: appDataClientMocks.refreshExternalAppsSnapshot,
  refreshGitHubCliState: appDataClientMocks.refreshGitHubCliState,
  saveSession: appDataClientMocks.saveSession,
  setGlobalShortcut: appDataClientMocks.setGlobalShortcut,
  setGlobalShortcutDisabled: appDataClientMocks.setGlobalShortcutDisabled,
  setLanEnabled: appDataClientMocks.setLanEnabled,
  setRecentWorkspaceExternalApp: appDataClientMocks.setRecentWorkspaceExternalApp,
  setSettingsFetchInterval: appDataClientMocks.setSettingsFetchInterval,
  setShortcutsDisabled: appDataClientMocks.setShortcutsDisabled,
  setTerminalNotificationsEnabled: appDataClientMocks.setTerminalNotificationsEnabled,
}))

describe('settings actions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    appDataClientMocks.addRecentRepo.mockReset()
    appDataClientMocks.addRecentRepo.mockResolvedValue({ recentRepos: [], addedRepo: null })
    appDataClientMocks.clearRecentRepos.mockReset()
    appDataClientMocks.clearRecentRepos.mockResolvedValue(undefined)
    appDataClientMocks.getSettingsSnapshot.mockReset()
    appDataClientMocks.getSettingsSnapshot.mockResolvedValue(defaultSettingsSnapshot())
    appDataClientMocks.refreshExternalAppsSnapshot.mockReset()
    appDataClientMocks.refreshExternalAppsSnapshot.mockResolvedValue({
      terminal: {
        available: false,
        appAvailability: { ghostty: false, terminal: false, windowsTerminal: false },
        detectedAt: 0,
      },
      editor: {
        available: false,
        appAvailability: { vscode: false },
        detectedAt: 0,
      },
    })
    appDataClientMocks.refreshGitHubCliState.mockReset()
    appDataClientMocks.refreshGitHubCliState.mockResolvedValue({
      available: false,
      version: null,
      detectedAt: 0,
      hosts: {},
    })
    appDataClientMocks.saveSession.mockReset()
    appDataClientMocks.saveSession.mockImplementation(async (session) => session)
    appDataClientMocks.setGlobalShortcut.mockReset()
    appDataClientMocks.setGlobalShortcut.mockImplementation(async (accelerator) => ({ accelerator, registered: true }))
    appDataClientMocks.setGlobalShortcutDisabled.mockReset()
    appDataClientMocks.setGlobalShortcutDisabled.mockImplementation(async (disabled) => disabled)
    appDataClientMocks.setLanEnabled.mockReset()
    appDataClientMocks.setLanEnabled.mockImplementation(async (enabled) => enabled)
    appDataClientMocks.setRecentWorkspaceExternalApp.mockReset()
    appDataClientMocks.setRecentWorkspaceExternalApp.mockResolvedValue({ repoSettings: [] })
    appDataClientMocks.setSettingsFetchInterval.mockReset()
    appDataClientMocks.setSettingsFetchInterval.mockImplementation(async (sec) => sec)
    appDataClientMocks.setShortcutsDisabled.mockReset()
    appDataClientMocks.setShortcutsDisabled.mockImplementation(async (disabled) => disabled)
    appDataClientMocks.setTerminalNotificationsEnabled.mockReset()
    appDataClientMocks.setTerminalNotificationsEnabled.mockImplementation(async (enabled) => enabled)
  })

  test('recordRecentRepo syncs recent repos into the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    appDataClientMocks.addRecentRepo.mockResolvedValue({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
      addedRepo: { kind: 'local', id: '/tmp/repo-a' },
    })
    const { recordRecentRepo } = await import('#/web/settings-actions.ts')

    await recordRecentRepo({ kind: 'local', id: '/tmp/repo-a' })

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
    })
  })

  test('clearRecentRepoHistory clears recent repos from the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }] }),
    )
    const { clearRecentRepoHistory } = await import('#/web/settings-actions.ts')

    await clearRecentRepoHistory()

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentRepos: [],
    })
  })

  test('persistWorkspaceSessionState syncs the saved session into the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const session = {
      ...defaultWorkspaceSessionState(),
      openRepoEntries: [{ kind: 'local' as const, id: '/tmp/repo-a' }],
      restoredRepoId: '/tmp/repo-a',
    }
    appDataClientMocks.saveSession.mockResolvedValue(session)
    const { persistWorkspaceSessionState } = await import('#/web/settings-actions.ts')

    await persistWorkspaceSessionState(session)

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      session,
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
    const { refreshGitHubCliDetection } = await import('#/web/settings-actions.ts')

    await refreshGitHubCliDetection()

    expect(primaryWindowQueryClient.getQueryData(githubCliQueryKey())).toMatchObject({
      available: true,
      version: '2.70.0',
    })
  })

  test('setLanEnabled updates runtime settings cache and invalidates LAN info', async () => {
    const invalidateSpy = vi.spyOn(primaryWindowQueryClient, 'invalidateQueries')
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const { setLanEnabled } = await import('#/web/settings-actions.ts')

    await setLanEnabled(true)

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({ lanEnabled: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: lanInfoQueryKey() })
    invalidateSpy.mockRestore()
  })

  test('uses server canonical runtime boolean preferences as cache values', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({
        terminalNotificationsEnabled: false,
        shortcutsDisabled: false,
        globalShortcutDisabled: false,
        lanEnabled: false,
      }),
    )
    appDataClientMocks.setTerminalNotificationsEnabled.mockResolvedValue(false)
    appDataClientMocks.setShortcutsDisabled.mockResolvedValue(false)
    appDataClientMocks.setGlobalShortcutDisabled.mockResolvedValue(false)
    appDataClientMocks.setLanEnabled.mockResolvedValue(false)
    const {
      setTerminalNotificationsEnabled,
      setShortcutsDisabled,
      setGlobalShortcutDisabled,
      setLanEnabled,
    } = await import('#/web/settings-actions.ts')

    await setTerminalNotificationsEnabled(true)
    await setShortcutsDisabled(true)
    await setGlobalShortcutDisabled(true)
    await setLanEnabled(true)

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      terminalNotificationsEnabled: false,
      shortcutsDisabled: false,
      globalShortcutDisabled: false,
      lanEnabled: false,
    })
  })

  test('leaves runtime settings cache unchanged when the server write fails', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
    )
    appDataClientMocks.setTerminalNotificationsEnabled.mockRejectedValue(new Error('settings unavailable'))
    const { setTerminalNotificationsEnabled } = await import('#/web/settings-actions.ts')

    await expect(setTerminalNotificationsEnabled(true)).rejects.toThrow('settings unavailable')

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      terminalNotificationsEnabled: false,
    })
  })

  test('uses the server shortcut registration result as the cache value', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ globalShortcut: 'Alt+Space', globalShortcutRegistered: true }),
    )
    appDataClientMocks.setGlobalShortcut.mockResolvedValue({ accelerator: 'Ctrl+Space', registered: false })
    const { setGlobalShortcut } = await import('#/web/settings-actions.ts')

    const state = await setGlobalShortcut('Ctrl+Space')

    expect(state).toEqual({ accelerator: 'Ctrl+Space', registered: false })
    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      globalShortcut: 'Ctrl+Space',
      globalShortcutRegistered: false,
    })
  })

  test('setRecentWorkspaceExternalAppPreference syncs server repo settings into the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ repoSettings: [] }))
    appDataClientMocks.setRecentWorkspaceExternalApp.mockResolvedValue({
      repoSettings: [
        {
          repoId: '/tmp/repo-a',
          workspaceExternalAppRecent: { byWorktree: { '/tmp/repo-a': 'editor:vscode' } },
        },
      ],
    })
    const { setRecentWorkspaceExternalAppPreference } = await import('#/web/settings-actions.ts')

    await setRecentWorkspaceExternalAppPreference({
      repoId: '/tmp/repo-a',
      worktreePath: '/tmp/repo-a',
      itemId: 'editor:vscode',
    })

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      repoSettings: [
        {
          repoId: '/tmp/repo-a',
          workspaceExternalAppRecent: { byWorktree: { '/tmp/repo-a': 'editor:vscode' } },
        },
      ],
    })
  })
})
