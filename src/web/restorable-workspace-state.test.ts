import { describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoreRestorableWorkspaceStateFromSession,
  sessionStateFromRestorableWorkspaceState,
} from '#/web/restorable-workspace-state.ts'
import { createRepoBranch, seedRepoState } from '#/web/stores/repos/test-utils.ts'

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
          workspaceFocused: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {
            '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
          },
        },
      }),
    ).toEqual({
      openRepos: [localRepoSessionEntry('/tmp/repo')],
      activeRepo: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSize: 55,
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
      },
      preferredWorkspacePaneViewByBranchByRepo: { '/tmp/repo': { 'feature/worktree': 'terminal' } },
      openBranchWorkspacePaneViewsByBranchByRepo: { '/tmp/repo': { 'feature/worktree': ['status'] } },
    })
  })

  test('does not persist runtime-owned changes as a session-restorable preferred view', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'changes',
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          workspaceFocused: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneViewByBranchByRepo: {},
      openBranchWorkspacePaneViewsByBranchByRepo: { '/tmp/repo': { 'feature/worktree': ['status'] } },
    })
  })

  test('does not persist a branch preferred view whose tab is closed', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'history',
      openBranchWorkspacePaneViews: ['status'],
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          workspaceFocused: false,
          workspacePaneSize: 55,
          selectedTerminalByWorktree: {},
        },
      }),
    ).toMatchObject({
      preferredWorkspacePaneViewByBranchByRepo: {},
      openBranchWorkspacePaneViewsByBranchByRepo: { '/tmp/repo': { 'feature/worktree': ['status'] } },
    })
  })

  test('restores restorable workspace state from SessionState', () => {
    expect(
      restoreRestorableWorkspaceStateFromSession({
        openRepos: [localRepoSessionEntry('/tmp/repo')],
        activeRepo: '/tmp/repo',
        workspaceFocused: false,
        workspacePaneSize: 40,
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
        },
        openBranchWorkspacePaneViewsByBranchByRepo: {
          '/tmp/repo': {
            main: [],
          },
        },
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSize: 40,
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
      },
      preferredWorkspacePaneViewByBranchByRepo: {},
      openBranchWorkspacePaneViewsByBranchByRepo: {
        '/tmp/repo': {
          main: [],
        },
      },
    })
  })
})
