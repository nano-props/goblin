import { describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import { restoreWorkspaceUiFromSession, sessionStateFromPersistableWorkspaceUi } from '#/web/workspace-ui-persistence-state.ts'
import { createRepoBranch, seedRepoState } from '#/web/stores/repos/test-utils.ts'

describe('workspace-ui-persistence-state', () => {
  test('maps persistable workspace ui state into SessionState', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })

    expect(
      sessionStateFromPersistableWorkspaceUi({
        routeRepoId: null,
        repos: { [repo.id]: repo },
        persistableWorkspaceUiState: {
          order: [repo.id],
          activeId: repo.id,
          detailCollapsed: false,
          detailFocusMode: true,
          workspaceLayout: 'left-right',
          detailPaneSizes: { 'top-bottom': 45, 'left-right': 55 },
          selectedTerminalByWorktree: {
            '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
          },
        },
      }),
    ).toEqual({
      openRepos: [localRepoSessionEntry('/tmp/repo')],
      activeRepo: '/tmp/repo',
      detailCollapsed: false,
      detailFocusMode: true,
      workspaceLayout: 'left-right',
      detailPaneSizes: { 'top-bottom': 45, 'left-right': 55 },
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
      },
    })
  })

  test('restores workspace ui state from SessionState', () => {
    expect(
      restoreWorkspaceUiFromSession({
        openRepos: [localRepoSessionEntry('/tmp/repo')],
        activeRepo: '/tmp/repo',
        detailCollapsed: true,
        detailFocusMode: false,
        workspaceLayout: 'top-bottom',
        detailPaneSizes: { 'top-bottom': 60, 'left-right': 40 },
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
        },
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      detailCollapsed: true,
      detailFocusMode: false,
      workspaceLayout: 'top-bottom',
      detailPaneSizes: { 'top-bottom': 60, 'left-right': 40 },
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-1',
      },
    })
  })
})
