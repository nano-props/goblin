import { describe, expect, test } from 'vitest'
import {
  buildRuntimeRecentReposState,
  buildRuntimeSettingsSnapshot,
  buildSettingsSnapshot,
  restorableWorkspaceSessionStateFromSettingsSnapshot,
  runtimeRecentReposStateFromSettingsSnapshot,
  runtimeSettingsSnapshotFromSettingsSnapshot,
} from '#/shared/settings-snapshot.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

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
          globalShortcut: 'CommandOrControl+Shift+K',
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
      globalShortcut: 'CommandOrControl+Shift+K',
      globalShortcutRegistered: true,
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
    const mainTargetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: '/tmp/repo-b',
      branchName: 'main',
      worktreePath: null,
    })
    const snapshot = buildSettingsSnapshot({
      prefs: {
        lang: 'auto',
        theme: 'auto',
        colorTheme: 'macos',
        fetchIntervalSec: 120,
        terminalNotificationsEnabled: false,
        shortcutsDisabled: false,
        globalShortcutDisabled: true,
        globalShortcut: 'CommandOrControl+Shift+G',
        lanEnabled: false,
      },
      globalShortcutRegistered: false,
      recentRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
      repoSettings: [
        {
          repoId: '/tmp/repo-b',
          worktreeBootstrapTrust: {
            configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            trustedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
      session: {
        openRepoEntries: [{ kind: 'local', id: '/tmp/repo-b' }],
        restoredRepoId: '/tmp/repo-b',
        zenMode: false,
        workspacePaneSize: 50,
        selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo-b\0/tmp/repo-b': 'session-1' },
        preferredWorkspacePaneTabByTargetByRepo: {},
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo-b': {
            [mainTargetKey]: [],
          },
        },
        filetreeViewStateByWorktreeByRepo: {
          '/tmp/repo-b': {
            '/tmp/repo-b': {
              selectedKeys: ['README.md'],
              expandedKeys: ['src'],
              topVisibleRowIndex: 24,
            },
          },
        },
      },
    })

    expect(runtimeSettingsSnapshotFromSettingsSnapshot(snapshot)).toMatchObject({
      globalShortcutRegistered: false,
    })
    expect(runtimeRecentReposStateFromSettingsSnapshot(snapshot)).toEqual({
      recentRepos: [{ kind: 'local', id: '/tmp/repo-b' }],
    })
    expect(restorableWorkspaceSessionStateFromSettingsSnapshot(snapshot)).toEqual({
      openRepoEntries: [{ kind: 'local', id: '/tmp/repo-b' }],
      restoredRepoId: '/tmp/repo-b',
      zenMode: false,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: { '/tmp/repo-b\0/tmp/repo-b': 'session-1' },
      preferredWorkspacePaneTabByTargetByRepo: {},
      workspacePaneTabsByTargetByRepo: {
        '/tmp/repo-b': {
          [mainTargetKey]: [],
        },
      },
      filetreeViewStateByWorktreeByRepo: {
        '/tmp/repo-b': {
          '/tmp/repo-b': {
            selectedKeys: ['README.md'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 24,
          },
        },
      },
    })
    expect(snapshot.repoSettings).toEqual([
      {
        repoId: '/tmp/repo-b',
        worktreeBootstrapTrust: {
          configHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          trustedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ])
  })
})
