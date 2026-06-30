// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'

const persistWorkspaceSessionStateMock = vi.fn(async (_session: unknown) => {})

vi.mock('#/web/settings-actions.ts', () => ({
  persistWorkspaceSessionState: (session: unknown) => persistWorkspaceSessionStateMock(session),
}))

beforeEach(() => {
  resetReposStore()
  resetFiletreeInteractionStore()
  persistWorkspaceSessionStateMock.mockReset()
})

describe('useSessionPersistence', () => {
  test('persists the active terminal map into settings session state', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/worktree': 'session-2',
      },
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
        activeRepoId: '/tmp/repo',
        selectedTerminalSessionIdByTerminalWorktree: {
          '/tmp/repo\0/tmp/worktree': 'session-2',
        },
        workspacePaneTabOrderByBranchByRepo: {
          '/tmp/repo': {
            'feature/worktree': [workspacePaneStaticTabOrderEntry('status')],
          },
        },
      }),
    )
  })

  test('persists explicitly closed workspace pane tabs as empty arrays', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
    })
    useReposStore.getState().closeWorkspacePaneStaticTab(repo.id, 'status', 'feature/worktree')

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePaneTabOrderByBranchByRepo: {
          '/tmp/repo': {
            'feature/worktree': [],
          },
        },
      }),
    )
  })

  test('persists file tree selected, expanded, and scroll state into settings session state', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })
    const scopeKey = filetreeInteractionScopeKey(repo.id, '/tmp/worktree')
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
    })
    useFiletreeInteractionStore.getState().restoreViewState({
      [scopeKey]: {
        selectedKeys: ['src/web/index.ts'],
        expandedKeys: ['src', 'src/web'],
        topVisibleRowIndex: 320,
      },
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filetreeViewStateByWorktreeByRepo: {
          '/tmp/repo': {
            '/tmp/worktree': {
              selectedKeys: ['src/web/index.ts'],
              expandedKeys: ['src', 'src/web'],
              topVisibleRowIndex: 320,
            },
          },
        },
      }),
    )
  })
})

function Harness() {
  useSessionPersistence()
  return null
}
