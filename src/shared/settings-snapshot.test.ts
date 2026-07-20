import { describe, expect, test } from 'vitest'
import {
  buildRuntimeRecentWorkspacesState,
  buildRuntimeSettingsSnapshot,
  buildSettingsSnapshot,
  runtimeSettingsSnapshotFromSettingsSnapshot,
} from '#/shared/settings-snapshot.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const prefs = {
  lang: 'ja' as const,
  theme: 'dark' as const,
  colorTheme: 'github' as const,
  fetchIntervalSec: 300,
  terminalNotificationsEnabled: true,
  shortcutsDisabled: true,
  globalShortcutDisabled: false,
  globalShortcut: 'CommandOrControl+Shift+K',
  lanEnabled: true,
}

describe('settings snapshot partitions', () => {
  test('builds runtime settings without workspace restore state', () => {
    expect(buildRuntimeSettingsSnapshot({ prefs, globalShortcutRegistered: true })).toEqual({
      ...prefs,
      globalShortcutRegistered: true,
    })
  })

  test('builds runtime recent repos separately from settings prefs', () => {
    expect(
      buildRuntimeRecentWorkspacesState({
        recentWorkspaces: [{ id: workspaceIdForTest('goblin+file:///tmp/repo-a') }],
      }),
    ).toEqual({
      recentWorkspaces: [{ id: 'goblin+file:///tmp/repo-a' }],
    })
  })

  test('keeps workspace restore state out of the settings snapshot', () => {
    const snapshot = buildSettingsSnapshot({
      prefs,
      globalShortcutRegistered: false,
      recentWorkspaces: [{ id: workspaceIdForTest('goblin+file:///tmp/repo-b') }],
      workspaceSettings: [],
    })

    expect(runtimeSettingsSnapshotFromSettingsSnapshot(snapshot)).toMatchObject({
      globalShortcutRegistered: false,
    })
    expect(snapshot).not.toHaveProperty('session')
    expect(snapshot).not.toHaveProperty('workspace')
  })
})
