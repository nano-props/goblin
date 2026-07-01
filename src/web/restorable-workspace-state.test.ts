import { describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  workspaceSessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, seedRepoState } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

describe('restorable-workspace-state', () => {
  test('maps restorable workspace state into WorkspaceSessionState', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {
            '/tmp/repo\0/tmp/worktree': 'session-2',
          },
        },
      }),
    ).toEqual({
      openRepoEntries: [localRepoSessionEntry('/tmp/repo')],
      activeRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'session-2',
      },
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'terminal' } },
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabEntry('status')] },
      },
      filetreeViewStateByWorktreeByRepo: {},
    })
  })

  test('persists changes as a session-restorable preferred tab when its static tab is open', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'changes' } },
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': {
          'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
        },
      },
    })
  })

  test('does not persist a branch preferred tab whose tab is closed', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabEntry('status')] },
      },
    })
  })

  test('restores restorable workspace state from WorkspaceSessionState', () => {
    expect(
      restoreRestorableWorkspaceStateFromSession({
        openRepoEntries: [localRepoSessionEntry('/tmp/repo')],
        activeRepoId: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalSessionIdByTerminalWorktree: {
          '/tmp/repo\0/tmp/worktree': 'session-1',
        },
        preferredWorkspacePaneTabByBranchByRepo: {},
        workspacePaneTabsByBranchByRepo: {
          '/tmp/repo': {
            main: [],
          },
        },
        filetreeViewStateByWorktreeByRepo: {},
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'session-1',
      },
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
    })
  })

  test('persists files as a session-restorable preferred tab when its static tab is open', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'files' } },
      workspacePaneTabsByBranchByRepo: {
        '/tmp/repo': {
          'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
        },
      },
    })
  })

  test('round-trips a files tab through session-restore', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    const sessionState = workspaceSessionStateFromRestorableWorkspaceState({
      repos: { [repo.id]: repo },
      restorableWorkspaceState: {
        order: [repo.id],
        activeId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalSessionIdByTerminalWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromSession(sessionState)
    expect(restored.workspacePaneTabsByBranchByRepo).toEqual({
      '/tmp/repo': {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    expect(restored.preferredWorkspacePaneTabByBranchByRepo).toEqual({
      '/tmp/repo': { 'feature/worktree': 'files' },
    })
  })

  test('persists file tree view state into session state', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })

    expect(
      workspaceSessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalSessionIdByTerminalWorktree: {},
        },
        filetreeInteractionByScope: {
          '/tmp/repo\0/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      }),
    ).toMatchObject({
      filetreeViewStateByWorktreeByRepo: {
        '/tmp/repo': {
          '/tmp/worktree': {
            selectedKeys: ['src/index.ts'],
            expandedKeys: ['src'],
            topVisibleRowIndex: 180,
          },
        },
      },
    })
  })
})
