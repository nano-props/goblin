import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  persistedFiletreeViewStateByWorktreeByWorkspaceForSession,
  restoreFiletreeViewStateFromSession,
} from '#/web/filetree-session-state.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/workspaces/filetree-interaction-state.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/example-repo')
const CLOSED_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/closed-repo')
const PLAIN_WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/plain-workspace')

describe('filetree-session-state', () => {
  beforeEach(() => {
    resetFiletreeInteractionStore()
  })

  test('maps file tree interaction state into session view state for open worktrees', () => {
    const scopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/tmp/worktree')
    const staleScopeKey = filetreeInteractionScopeKey(WORKSPACE_ID, '/tmp/stale-worktree')
    const closedRepoScopeKey = filetreeInteractionScopeKey(CLOSED_WORKSPACE_ID, '/tmp/worktree')

    const persisted = persistedFiletreeViewStateByWorktreeByWorkspaceForSession(
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
        [WORKSPACE_ID]: {
          gitTargets: { branches: [{ worktree: { path: '/tmp/worktree' } }] },
        },
      },
      [WORKSPACE_ID],
    )

    expect(persisted).toEqual({
      [WORKSPACE_ID]: {
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
      [WORKSPACE_ID]: {
        'goblin+file:///tmp/worktree': {
          selectedKeys: ['src/index.ts'],
          expandedKeys: ['src', 'src/web'],
          topVisibleRowIndex: 120,
        },
      },
    })

    expect(
      useFiletreeInteractionStore.getState().interactionByScope[
        filetreeInteractionScopeKey(WORKSPACE_ID, '/tmp/worktree')
      ],
    ).toEqual({
      selectedKeys: ['src/index.ts'],
      expandedKeys: ['src', 'src/web'],
      topVisibleRowIndex: 120,
    })
  })

  test('persists the workspace-root file tree without a synthetic branch', () => {
    const persisted = persistedFiletreeViewStateByWorktreeByWorkspaceForSession(
      {
        [filetreeInteractionScopeKey(PLAIN_WORKSPACE_ID, '/tmp/plain-workspace')]: {
          selectedKeys: ['README.md'],
          expandedKeys: ['src'],
          topVisibleRowIndex: 3,
        },
      },
      { [PLAIN_WORKSPACE_ID]: {} },
      [PLAIN_WORKSPACE_ID],
    )

    expect(persisted).toEqual({
      [PLAIN_WORKSPACE_ID]: {
        [PLAIN_WORKSPACE_ID]: {
          selectedKeys: ['README.md'],
          expandedKeys: ['src'],
          topVisibleRowIndex: 3,
        },
      },
    })
  })
})
