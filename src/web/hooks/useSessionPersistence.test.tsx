// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const persistSessionStateMock = vi.fn(async (_session: unknown) => {})

vi.mock('#/web/settings-write-paths.ts', () => ({
  persistSessionState: (session: unknown) => persistSessionStateMock(session),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  persistSessionStateMock.mockReset()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
})

describe('useSessionPersistence', () => {
  test('persists the active terminal map into settings session state', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
      },
    })

    await render(<Harness />)

    expect(persistSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openRepos: [{ kind: 'local', id: '/tmp/repo' }],
        activeRepo: '/tmp/repo',
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/worktree': '/tmp/repo\0/tmp/worktree\0terminal-2',
        },
        openBranchWorkspacePaneViewsByBranchByRepo: {
          '/tmp/repo': {
            'feature/worktree': ['status'],
          },
        },
      }),
    )
  })

  test('persists explicitly closed branch workspace tabs as empty arrays', async () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    useReposStore.getState().closeBranchWorkspacePaneView(repo.id, 'status', 'feature/worktree')

    await render(<Harness />)

    expect(persistSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openBranchWorkspacePaneViewsByBranchByRepo: {
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

async function render(element: React.ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
}
