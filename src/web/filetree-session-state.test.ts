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
    const scopeKey = filetreeInteractionScopeKey('/tmp/repo', '/tmp/worktree')
    const staleScopeKey = filetreeInteractionScopeKey('/tmp/repo', '/tmp/stale-worktree')
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
        '/tmp/repo': {
          branches: [{ worktree: { path: '/tmp/worktree' } }],
        },
      },
      ['/tmp/repo'],
    )

    expect(persisted).toEqual({
      '/tmp/repo': {
        '/tmp/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
      },
    })
  })

  test('restores session view state into the file tree interaction store', () => {
    restoreFiletreeViewStateFromSession({
      '/tmp/repo': {
        '/tmp/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
      },
    })

    expect(
      useFiletreeInteractionStore.getState().interactionByScope[
        filetreeInteractionScopeKey('/tmp/repo', '/tmp/worktree')
      ],
    ).toEqual({
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 120,
    })
  })
})
