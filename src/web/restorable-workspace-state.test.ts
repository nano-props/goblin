import { describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  workspaceSessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, seedRepoState } from '#/web/test-utils/bridge.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

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
          selectedTerminalKeyByWorktree: {
            '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-2',
          },
        },
      }),
    ).toEqual({
      openRepoEntries: [localRepoSessionEntry('/tmp/repo')],
      activeRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalKeyByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-2',
      },
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'terminal' } },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabOrderEntry('status')] },
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('changes')],
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
          selectedTerminalKeyByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'changes' } },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': {
          'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('changes')],
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status')],
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
          selectedTerminalKeyByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabOrderEntry('status')] },
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
        selectedTerminalKeyByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-1',
        },
        workspacePaneTabOrderByBranchByRepo: {
          '/tmp/repo': {
            main: [],
          },
        },
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 40,
      selectedTerminalKeyByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-1',
      },
      preferredWorkspacePaneTabByBranchByRepo: {},
      workspacePaneTabOrderByBranchByRepo: {
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('files')],
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
          selectedTerminalKeyByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneTabByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'files' } },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': {
          'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('files')],
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('files')],
      },
    })

    const sessionState = workspaceSessionStateFromRestorableWorkspaceState({
      repos: { [repo.id]: repo },
      restorableWorkspaceState: {
        order: [repo.id],
        activeId: repo.id,
        zenMode: false,
        workspacePaneSize: 55,
        selectedTerminalKeyByWorktree: {},
      },
    })
    const restored = restoreRestorableWorkspaceStateFromSession(sessionState)
    expect(restored.workspacePaneTabOrderByBranchByRepo).toEqual({
      '/tmp/repo': {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('files')],
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
          selectedTerminalKeyByWorktree: {},
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
