// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState, defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { githubCliQueryKey, lanInfoQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { GitHubCliState, WorkspaceSettingsState, WorkspaceRestoreResult } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_A = workspaceIdForTest('goblin+file:///tmp/repo-a')

type AddRecentWorkspaceResult = {
  recentWorkspaces: WorkspaceSessionEntry[]
  addedWorkspace: WorkspaceSessionEntry | null
}

type RestoreServerWorkspaceMock = (
  clientId: string,
  options?: { activeWorkspaceId?: string | null; signal?: AbortSignal },
) => Promise<WorkspaceRestoreResult>

const appDataClientMocks = vi.hoisted(() => ({
  addRecentWorkspace: vi.fn<() => Promise<AddRecentWorkspaceResult>>(async () => ({
    recentWorkspaces: [],
    addedWorkspace: null,
  })),
  clearRecentWorkspaces: vi.fn(async () => {}),
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
  restoreServerWorkspace: vi.fn<RestoreServerWorkspaceMock>(async () => ({
    status: 'restored' as const,
    openWorkspaceEntries: [],
    runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: null },
  })),
  restoreWorkspaceTabs: vi.fn(async () => ({
    workspace: {
      entry: { kind: 'local' as const, id: 'goblin+file:///tmp/repo-a' },
      workspaceId: 'goblin+file:///tmp/repo-a',
      workspaceRuntimeId: 'repo_runtime_test',
      name: 'repo-a',
      projection: {
        snapshot: { current: 'main', branches: [] },
        pullRequests: null,
        operations: { operations: [], loadedAt: 0 },
        requested: { branch: null, pullRequestMode: 'full' as const },
        loadedAt: 1,
      },
    },
    snapshot: null,
  })),
  setGlobalShortcut: vi.fn(async (accelerator) => ({ accelerator, registered: true })),
  setGlobalShortcutDisabled: vi.fn(async (disabled) => disabled),
  setLanEnabled: vi.fn(async (enabled) => enabled),
  setRecentWorkspaceExternalApp: vi.fn<() => Promise<WorkspaceSettingsState>>(async () => ({ workspaceSettings: [] })),
  setSettingsFetchInterval: vi.fn(async (sec) => sec),
  setShortcutsDisabled: vi.fn(async (disabled) => disabled),
  setTerminalNotificationsEnabled: vi.fn(async (enabled) => enabled),
}))

vi.mock('#/web/settings-client.ts', () => ({
  addRecentWorkspace: appDataClientMocks.addRecentWorkspace,
  clearRecentWorkspaces: appDataClientMocks.clearRecentWorkspaces,
  getSettingsSnapshot: appDataClientMocks.getSettingsSnapshot,
  refreshExternalAppsSnapshot: appDataClientMocks.refreshExternalAppsSnapshot,
  refreshGitHubCliState: appDataClientMocks.refreshGitHubCliState,
  restoreWorkspaceTabs: appDataClientMocks.restoreWorkspaceTabs,
  restoreServerWorkspace: appDataClientMocks.restoreServerWorkspace,
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
    appDataClientMocks.addRecentWorkspace.mockReset()
    appDataClientMocks.addRecentWorkspace.mockResolvedValue({ recentWorkspaces: [], addedWorkspace: null })
    appDataClientMocks.clearRecentWorkspaces.mockReset()
    appDataClientMocks.clearRecentWorkspaces.mockResolvedValue(undefined)
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
    appDataClientMocks.restoreServerWorkspace.mockReset()
    appDataClientMocks.restoreServerWorkspace.mockResolvedValue({
      status: 'restored',
      openWorkspaceEntries: [],
      runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: null },
    })
    appDataClientMocks.restoreWorkspaceTabs.mockReset()
    appDataClientMocks.restoreWorkspaceTabs.mockResolvedValue({
      workspace: {
        entry: { kind: 'local', id: 'goblin+file:///tmp/repo-a' },
        workspaceId: 'goblin+file:///tmp/repo-a',
        workspaceRuntimeId: 'repo_runtime_test',
        name: 'repo-a',
        projection: {
          snapshot: { current: 'main', branches: [] },
          pullRequests: null,
          operations: { operations: [], loadedAt: 0 },
          requested: { branch: null, pullRequestMode: 'full' },
          loadedAt: 1,
        },
      },
      snapshot: null,
    })
    appDataClientMocks.setGlobalShortcut.mockReset()
    appDataClientMocks.setGlobalShortcut.mockImplementation(async (accelerator) => ({ accelerator, registered: true }))
    appDataClientMocks.setGlobalShortcutDisabled.mockReset()
    appDataClientMocks.setGlobalShortcutDisabled.mockImplementation(async (disabled) => disabled)
    appDataClientMocks.setLanEnabled.mockReset()
    appDataClientMocks.setLanEnabled.mockImplementation(async (enabled) => enabled)
    appDataClientMocks.setRecentWorkspaceExternalApp.mockReset()
    appDataClientMocks.setRecentWorkspaceExternalApp.mockResolvedValue({ workspaceSettings: [] })
    appDataClientMocks.setSettingsFetchInterval.mockReset()
    appDataClientMocks.setSettingsFetchInterval.mockImplementation(async (sec) => sec)
    appDataClientMocks.setShortcutsDisabled.mockReset()
    appDataClientMocks.setShortcutsDisabled.mockImplementation(async (disabled) => disabled)
    appDataClientMocks.setTerminalNotificationsEnabled.mockReset()
    appDataClientMocks.setTerminalNotificationsEnabled.mockImplementation(async (enabled) => enabled)
  })

  test('recordRecentWorkspace syncs recent repos into the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    appDataClientMocks.addRecentWorkspace.mockResolvedValue({
      recentWorkspaces: [{ kind: 'local', id: WORKSPACE_A }],
      addedWorkspace: { kind: 'local', id: WORKSPACE_A },
    })
    const { recordRecentWorkspace } = await import('#/web/settings-actions.ts')

    await recordRecentWorkspace({ kind: 'local', id: WORKSPACE_A })

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentWorkspaces: [{ kind: 'local', id: 'goblin+file:///tmp/repo-a' }],
    })
  })

  test('clearRecentWorkspaceHistory clears recent repos from the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ recentWorkspaces: [{ kind: 'local', id: WORKSPACE_A }] }),
    )
    const { clearRecentWorkspaceHistory } = await import('#/web/settings-actions.ts')

    await clearRecentWorkspaceHistory()

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      recentWorkspaces: [],
    })
  })

  test('restoreWorkspaceAtBoot returns the server-owned workspace restore result', async () => {
    primaryWindowQueryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot())
    const session = {
      ...defaultServerWorkspaceState(),
      openWorkspaceEntries: [{ kind: 'local' as const, id: WORKSPACE_A }],
      restoredWorkspaceId: WORKSPACE_A,
      workspacePaneSize: 333,
    }
    appDataClientMocks.restoreServerWorkspace.mockResolvedValue({
      status: 'repaired',
      openWorkspaceEntries: session.openWorkspaceEntries,
      runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: session.restoredWorkspaceId },
    })
    const { restoreWorkspaceAtBoot } = await import('#/web/settings-actions.ts')

    const result = await restoreWorkspaceAtBoot('client_test000000000000')

    expect(result).toEqual({
      status: 'repaired',
      openWorkspaceEntries: session.openWorkspaceEntries,
      runtime: { workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: session.restoredWorkspaceId },
    })
    expect(appDataClientMocks.restoreServerWorkspace).toHaveBeenCalledWith('client_test000000000000', undefined)
  })

  test('restoreWorkspaceTabsOnView delegates lazy repo tab restore to the settings client', async () => {
    const { restoreWorkspaceTabsOnView } = await import('#/web/settings-actions.ts')
    await expect(
      restoreWorkspaceTabsOnView(
        'client_test000000000000',
        workspaceIdForTest('goblin+file:///tmp/repo-a'),
        'repo_runtime_test',
      ),
    ).resolves.toMatchObject({
      workspace: { workspaceId: 'goblin+file:///tmp/repo-a', workspaceRuntimeId: 'repo_runtime_test' },
      snapshot: null,
    })

    expect(appDataClientMocks.restoreWorkspaceTabs).toHaveBeenCalledWith(
      'client_test000000000000',
      'goblin+file:///tmp/repo-a',
      'repo_runtime_test',
      undefined,
    )
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
    const { setTerminalNotificationsEnabled, setShortcutsDisabled, setGlobalShortcutDisabled, setLanEnabled } =
      await import('#/web/settings-actions.ts')

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

  test('setRecentWorkspaceExternalAppPreference syncs server workspace settings into the settings snapshot cache', async () => {
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ workspaceSettings: [] }),
    )
    appDataClientMocks.setRecentWorkspaceExternalApp.mockResolvedValue({
      workspaceSettings: [
        {
          workspaceId: WORKSPACE_A,
          workspaceExternalAppRecent: { byTarget: { 'workspace-root': 'editor:vscode' } },
        },
      ],
    })
    const { setRecentWorkspaceExternalAppPreference } = await import('#/web/settings-actions.ts')

    await setRecentWorkspaceExternalAppPreference({
      workspaceId: WORKSPACE_A,
      target: { kind: 'workspace-root' },
      itemId: 'editor:vscode',
    })

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      workspaceSettings: [
        {
          workspaceId: WORKSPACE_A,
          workspaceExternalAppRecent: { byTarget: { 'workspace-root': 'editor:vscode' } },
        },
      ],
    })
  })
})
