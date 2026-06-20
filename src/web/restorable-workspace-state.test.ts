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
      workspacePaneView: 'terminal',
    })

    expect(
      sessionStateFromRestorableWorkspaceState({
        repos: { [repo.id]: repo },
        restorableWorkspaceState: {
          order: [repo.id],
          activeId: repo.id,
          workspacePaneFocusMode: true,
          workspacePaneSizes: { 'left-right': 55 },
          selectedTerminalByWorktree: {
            '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
          },
          workspacePaneViewByRepo: {},
        },
      }),
    ).toEqual({
      openRepos: [localRepoSessionEntry('/tmp/repo')],
      activeRepo: '/tmp/repo',
      workspacePaneFocusMode: true,
      workspacePaneSizes: { 'left-right': 55 },
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
      },
      workspacePaneViewByRepo: { '/tmp/repo': 'terminal' },
    })
  })

  test('restores restorable workspace state from SessionState', () => {
    expect(
      restoreRestorableWorkspaceStateFromSession({
        openRepos: [localRepoSessionEntry('/tmp/repo')],
        activeRepo: '/tmp/repo',
        workspacePaneFocusMode: false,
        workspacePaneSizes: { 'left-right': 40 },
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
        },
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      workspacePaneFocusMode: false,
      workspacePaneSizes: { 'left-right': 40 },
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
      },
      workspacePaneViewByRepo: {},
    })
  })
})
