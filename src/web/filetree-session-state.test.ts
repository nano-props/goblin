import { beforeEach, describe, expect, test } from 'vitest'
import {
  persistedFiletreeViewStateByWorktreeByRepoForSession,
  restoreFiletreeViewStateFromSession,
} from '#/web/filetree-session-state.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'

describe('filetree-session-state', () => {
  beforeEach(() => {
    resetFiletreeInteractionStore()
  })

  test('maps file tree interaction state into session view state for open worktrees', () => {
    const scopeKey = filetreeInteractionScopeKey('goblin+file:///tmp/repo', '/tmp/worktree')
    const staleScopeKey = filetreeInteractionScopeKey('goblin+file:///tmp/repo', '/tmp/stale-worktree')
    const closedRepoScopeKey = filetreeInteractionScopeKey('/tmp/closed-repo', '/tmp/worktree')

    const persisted = persistedFiletreeViewStateByWorktreeByRepoForSession(
      {
        [scopeKey]: {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
        [staleScopeKey]: {
          selectedKeys: ['README.md'],
          expandedKeys: [],
          topVisibleRowIndex: 0,
        },
        [closedRepoScopeKey]: {
          selectedKeys: [],
          expandedKeys: ['docs'],
          topVisibleRowIndex: 0,
        },
      },
      {
        'goblin+file:///tmp/repo': {
          branches: [{ worktree: { path: '/tmp/worktree' } }],
        },
      },
      ['goblin+file:///tmp/repo'],
    )

    expect(persisted).toEqual({
      'goblin+file:///tmp/repo': {
        'goblin+file:///tmp/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
      },
    })
  })

  test('restores session view state into the file tree interaction store', () => {
    restoreFiletreeViewStateFromSession({
      'goblin+file:///tmp/repo': {
        'goblin+file:///tmp/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
      },
    })

    expect(
      useFiletreeInteractionStore.getState().interactionByScope[
        filetreeInteractionScopeKey('goblin+file:///tmp/repo', '/tmp/worktree')
      ],
    ).toEqual({
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 120,
    })
  })

  test('persists the workspace-root file tree without a synthetic branch', () => {
    const workspaceId = 'goblin+file:///tmp/plain-workspace'
    const persisted = persistedFiletreeViewStateByWorktreeByRepoForSession(
      {
        [filetreeInteractionScopeKey(workspaceId, '/tmp/plain-workspace')]: {
          selectedKeys: ['README.md'],
          expandedKeys: ['src'],
          topVisibleRowIndex: 3,
        },
      },
      { [workspaceId]: { branches: [] } },
      [workspaceId],
    )

    expect(persisted).toEqual({
      [workspaceId]: {
        [workspaceId]: {
          selectedKeys: ['README.md'],
          expandedKeys: ['src'],
          topVisibleRowIndex: 3,
        },
      },
    })
  })
})
