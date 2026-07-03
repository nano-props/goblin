// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useSessionPersistence } from '#/web/hooks/useSessionPersistence.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  filetreeInteractionScopeKey,
  resetFiletreeInteractionStore,
  useFiletreeInteractionStore,
} from '#/web/stores/repos/filetree-interaction-state.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  replaceWorkspacePaneTabsQueryData,
  setWorkspacePaneTabsForTargetQueryData,
  useWorkspacePaneTabsQuery,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'

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
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      sessionPersistenceReady: true,
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
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [workspacePaneStaticTabEntry('status')],
          },
        },
      }),
    )
  })

  test('persists explicitly closed workspace pane tabs as empty arrays', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [],
      },
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [],
          },
        },
      }),
    )
  })

  test('persists workspace pane tabs from the server query projection', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: repo.id,
      repoInstanceId: repo.instanceId,
      branchName: 'feature/worktree',
      worktreePath: '/tmp/worktree',
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredWorkspacePaneTabByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: 'history',
          },
        },
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [workspacePaneStaticTabEntry('history')],
          },
        },
      }),
    )
  })

  test('persists workspace pane tabs when the server projection is refreshed', async () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      sessionPersistenceReady: true,
    })

    renderInJsdom(<Harness />)
    persistWorkspaceSessionStateMock.mockClear()

    act(() => {
      replaceWorkspacePaneTabsQueryData(repo.id, repo.instanceId, [
        {
          repoRoot: repo.id,
          branchName: 'feature/worktree',
          worktreePath: '/tmp/worktree',
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ])
    })

    await vi.waitFor(() => {
      expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePaneTabsByTargetByRepo: {
            '/tmp/repo': {
              [targetKey]: [workspacePaneStaticTabEntry('history')],
            },
          },
        }),
      )
    })
  })

  test('validates persisted workspace tab targets against query-backed branches', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/query-worktree', '/tmp/query-worktree')
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('main')],
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'history',
    })
    setRepoSnapshotQueryData(repo.id, repo.instanceId, {
      branches: [createRepoBranch('feature/query-worktree', { worktree: { path: '/tmp/query-worktree' } })],
      current: 'feature/query-worktree',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: repo.id,
      repoInstanceId: repo.instanceId,
      branchName: 'feature/query-worktree',
      worktreePath: '/tmp/query-worktree',
      tabs: [workspacePaneStaticTabEntry('history')],
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [workspacePaneStaticTabEntry('history')],
          },
        },
      }),
    )
  })

  test('persists workspace pane tabs from the current repo runtime instance', () => {
    const targetKey = worktreeTargetKey('/tmp/repo', 'feature/worktree', '/tmp/worktree')
    const oldInstanceId = 'repo-instance-old'
    const currentInstanceId = 'repo-instance-current'
    const repo = seedRepoState({
      id: '/tmp/repo',
      instanceId: oldInstanceId,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: repo.id,
      repoInstanceId: oldInstanceId,
      branchName: 'feature/worktree',
      worktreePath: '/tmp/worktree',
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: repo.id,
      repoInstanceId: currentInstanceId,
      branchName: 'feature/worktree',
      worktreePath: '/tmp/worktree',
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    useReposStore.setState({
      repos: {
        [repo.id]: {
          ...repo,
          instanceId: currentInstanceId,
        },
      },
    })

    renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePaneTabsByTargetByRepo: {
          '/tmp/repo': {
            [targetKey]: [workspacePaneStaticTabEntry('history')],
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
      sessionPersistenceReady: true,
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

  test('does not persist until boot-restored workspace tabs have converged', () => {
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      sessionPersistenceReady: false,
    })

    const result = renderInJsdom(<Harness />)

    expect(persistWorkspaceSessionStateMock).not.toHaveBeenCalled()

    act(() => {
      useReposStore.setState({ sessionPersistenceReady: true })
    })

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        openRepoEntries: [{ kind: 'local', id: '/tmp/repo' }],
      }),
    )
    result.unmount()
  })

  test('does not emit a render-phase update warning when a workspace tabs observer mounts', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      sessionPersistenceReady: true,
    })

    const result = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <>
          <Harness />
          <WorkspacePaneTabsObserver repoId={repo.id} repoInstanceId={repo.instanceId} />
        </>
      </QueryClientProvider>,
    )

    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot update a component (`AuthenticatedSideEffects`) while rendering a different component',
      ),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )

    errorSpy.mockRestore()
    result.unmount()
  })

  test('coalesces overlapping session saves into the latest state', async () => {
    const persistDeferred = Promise.withResolvers<void>()
    persistWorkspaceSessionStateMock.mockImplementationOnce(async () => await persistDeferred.promise)
    persistWorkspaceSessionStateMock.mockImplementation(async () => {})

    const repo = seedRepoState({
      id: '/tmp/repo',
      branches: [createRepoBranch('feature/worktree', { worktree: { path: '/tmp/worktree' } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    useReposStore.setState({
      repos: { [repo.id]: repo },
      order: [repo.id],
      activeId: repo.id,
      sessionReady: true,
      sessionPersistenceReady: true,
    })

    renderInJsdom(<Harness />)
    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledTimes(1)

    act(() => {
      useReposStore.setState({ zenMode: true })
      useReposStore.setState({ workspacePaneSize: 60 })
    })

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledTimes(1)
    persistDeferred.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(persistWorkspaceSessionStateMock).toHaveBeenCalledTimes(2)
    expect(persistWorkspaceSessionStateMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        zenMode: true,
        workspacePaneSize: 60,
      }),
    )
  })
})

function Harness() {
  useSessionPersistence()
  return null
}

function WorkspacePaneTabsObserver({ repoId, repoInstanceId }: { repoId: string; repoInstanceId: string }) {
  useWorkspacePaneTabsQuery(repoId, repoInstanceId)
  return null
}

function worktreeTargetKey(repoRoot: string, branchName: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot, branchName, worktreePath })
}
