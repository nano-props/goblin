import { describe, expect, test } from 'vitest'
import {
  buildRuntimeRecentReposState,
  buildRuntimeSettingsSnapshot,
  buildSettingsSnapshot,
  restorableSessionStateFromSettingsSnapshot,
  runtimeRecentReposStateFromSettingsSnapshot,
  runtimeSettingsSnapshotFromSettingsSnapshot,
} from '#/shared/settings-snapshot.ts'

describe('settings snapshot partitions', () => {
  test('builds runtime settings without recent repo or restorable session fields', () => {
    expect(
      buildRuntimeSettingsSnapshot({
        prefs: {
          lang: 'ja',
          theme: 'dark',
          colorTheme: 'github',
          fetchIntervalSec: 300,
          terminalNotificationsEnabled: true,
          shortcutsDisabled: true,
          globalShortcutDisabled: false,
          swapCloseShortcuts: true,
          globalShortcut: 'CommandOrControl+Shift+K',
          terminalApp: 'ghostty',
          editorApp: 'cursor',
          lanEnabled: true,
        },
        globalShortcutRegistered: true,
      }),
    ).toEqual({
      lang: 'ja',
      theme: 'dark',
      colorTheme: 'github',
      fetchIntervalSec: 300,
      terminalNotificationsEnabled: true,
      shortcutsDisabled: true,
      globalShortcutDisabled: false,
      swapCloseShortcuts: true,
      globalShortcut: 'CommandOrControl+Shift+K',
      globalShortcutRegistered: true,
      terminalApp: 'ghostty',
      editorApp: 'cursor',
      lanEnabled: true,
    })
  })

  test('builds runtime recent repos separately from settings prefs', () => {
    expect(
      buildRuntimeRecentReposState({
        recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
      }),
    ).toEqual({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-a' }],
    })
  })

  test('splits a full settings snapshot into runtime settings and restorable session', () => {
    const snapshot = buildSettingsSnapshot({
      prefs: {
        lang: 'auto',
        theme: 'auto',
        colorTheme: 'macos',
        fetchIntervalSec: 120,
        terminalNotificationsEnabled: false,
        shortcutsDisabled: false,
        globalShortcutDisabled: true,
        swapCloseShortcuts: false,
        globalShortcut: 'CommandOrControl+Shift+G',
        terminalApp: 'auto',
        editorApp: 'auto',
        lanEnabled: false,
      },
      globalShortcutRegistered: false,
      recentRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
      session: {
        openRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
        activeRepo: '/tmp/repo-b',
        workspacePaneFocusMode: true,
        workspacePaneSizes: { 'left-right': 50 },
        selectedTerminalByWorktree: { '/tmp/repo-b\0/tmp/repo-b': 'terminal-1' },
      },
    })

    expect(runtimeSettingsSnapshotFromSettingsSnapshot(snapshot)).toMatchObject({
      globalShortcutRegistered: false,
    })
    expect(runtimeRecentReposStateFromSettingsSnapshot(snapshot)).toEqual({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
    })
    expect(restorableSessionStateFromSettingsSnapshot(snapshot)).toEqual({
      openRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
      activeRepo: '/tmp/repo-b',
      workspacePaneFocusMode: true,
      workspacePaneSizes: { 'left-right': 50 },
      selectedTerminalByWorktree: { '/tmp/repo-b\0/tmp/repo-b': 'terminal-1' },
    })
  })
})
