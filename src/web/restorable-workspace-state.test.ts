import { describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  sessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

describe('restorable-workspace-state', () => {
  test('maps restorable workspace state into SessionState', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {
            '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-2',
          },
        },
      }),
    ).toEqual({
      openRepos: [localRepoSessionEntry('/tmp/repo')],
      activeRepo: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 55,
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-2',
      },
      preferredWorkspacePaneViewByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'terminal' } },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabOrderEntry('status')] },
      },
    })
  })

  test('persists changes as a session-restorable preferred view when its static tab is open', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('changes')],
      },
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneViewByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'changes' } },
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': {
          'feature/worktree': [workspacePaneStaticTabOrderEntry('status'), workspacePaneStaticTabOrderEntry('changes')],
        },
      },
    })
  })

  test('does not persist a branch preferred view whose tab is closed', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [workspacePaneStaticTabOrderEntry('status')],
      },
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          zenMode: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneViewByBranchByRepo: {},
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': { 'feature/worktree': [workspacePaneStaticTabOrderEntry('status')] },
      },
    })
  })

  test('restores restorable workspace state from SessionState', () => {
    expect(
      restoreRestorableWorkspaceStateFromSession({
        openRepos: [localRepoSessionEntry('/tmp/repo')],
        activeRepo: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 40,
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-1',
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
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0slot-1',
      },
      preferredWorkspacePaneViewByBranchByRepo: {},
      workspacePaneTabOrderByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
    })
  })
})
