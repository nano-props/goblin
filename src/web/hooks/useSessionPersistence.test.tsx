// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'

const persistWorkspaceSessionStateMock = vi.fn(async (_session: unknown) => {})

vi.mock('#/web/settings-actions.ts', () => ({
  persistWorkspaceSessionState: (session: unknown) => persistWorkspaceSessionStateMock(session),
}))

beforeEach(() => {
  resetReposStore()
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
      selectedTerminalSessionByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-2',
      },
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
        activeRepoId: '/tmp/repo',
        selectedTerminalSessionByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0session-2',
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
})

function Harness() {
  useSessionPersistence()
  return null
}
