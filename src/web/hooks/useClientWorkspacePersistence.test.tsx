// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { workspaceLocatorForPath, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { useFiletreeInteractionStore } from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { createBranchSnapshot, resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'

const writePresentationMock = vi.fn()

vi.mock('#/web/client-workspace-state.ts', () => ({
  writeClientWorkspaceState: (presentation: unknown) => writePresentationMock(presentation),
}))

beforeEach(() => {
  vi.useRealTimers()
  resetWorkspacesStore()
  useFiletreeInteractionStore.setState({ interactionByScope: {} })
  writePresentationMock.mockReset()
})

describe('useClientWorkspacePersistence', () => {
  test('persists client-owned workspace state without canonical tabs', () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      zenMode: true,
      workspacePaneSize: 55,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })

    renderInJsdom(<Harness routedWorkspaceId={repo.id} />)

    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({ restoredWorkspaceId: repo.id, zenMode: true, workspacePaneSize: 55 }),
    )
    const saved = writePresentationMock.mock.calls[0]?.[0]
    expect(saved).not.toHaveProperty('openWorkspaceEntries')
    expect(saved).not.toHaveProperty('workspacePaneTabsByTargetByWorkspace')
  })

  test('persists the routed workspace identity before its store projection is hydrated', () => {
    const routedWorkspaceId = workspaceIdForTest('goblin+file:///tmp/routed-workspace')
    useWorkspacesStore.setState({
      workspaces: {},
      workspaceOrder: [],
      restoredWorkspaceId: null,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })

    renderInJsdom(<Harness routedWorkspaceId={routedWorkspaceId} />)

    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({ restoredWorkspaceId: routedWorkspaceId }),
    )
  })

  test('persists terminal selection, preferred tab, and filetree presentation', () => {
    const worktreePath = '/tmp/repo-worktree'
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree',
      workspaceId: workspaceIdForTest('goblin+file:///tmp/repo'),
      worktreePath,
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(
      workspaceIdForTest('goblin+file:///tmp/repo'),
      worktreePath,
    )
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/repo')
    const worktreeId = workspaceLocatorForPath(workspaceId, worktreePath)
    if (!worktreeId) throw new Error('expected a canonical worktree locator fixture')
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/worktree': [workspacePaneStaticTabEntry('history')] },
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [terminalFilesystemTargetKey]: 'term-111111111111111111111',
      },
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    useFiletreeInteractionStore.getState().restoreViewState({
      [`goblin+file:///tmp/repo\0${worktreePath}`]: {
        selectedKeys: ['src/index.ts'],
        expandedKeys: ['src'],
        topVisibleRowIndex: 12,
      },
    })

    renderInJsdom(<Harness />)

    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          [terminalFilesystemTargetKey]: 'term-111111111111111111111',
        },
        preferredWorkspacePaneTabByTargetByWorkspace: { 'goblin+file:///tmp/repo': { [targetKey]: 'history' } },
        filetreeViewStateByFilesystemTargetByWorkspace: {
          'goblin+file:///tmp/repo': {
            [worktreeId]: {
              selectedKeys: ['src/index.ts'],
              expandedKeys: ['src'],
              topVisibleRowIndex: 12,
            },
          },
        },
      }),
    )
  })

  test('does not persist before workspace restore converges', () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      workspaceMembershipReady: true,
      sessionPersistenceReady: false,
    })

    renderInJsdom(<Harness />)
    expect(writePresentationMock).not.toHaveBeenCalled()
  })

  test('debounces high-frequency presentation changes to the latest state', () => {
    vi.useFakeTimers()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    renderInJsdom(<Harness />)
    writePresentationMock.mockClear()

    act(() => {
      useWorkspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-111111111111111111111',
        },
      })
      useWorkspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-222222222222222222222',
        },
      })
    })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(writePresentationMock).toHaveBeenCalledOnce()
    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-222222222222222222222',
        },
      }),
    )
  })

  test('flushes a pending local presentation synchronously on pagehide', () => {
    vi.useFakeTimers()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    renderInJsdom(<Harness />)
    writePresentationMock.mockClear()

    act(() => {
      useWorkspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-333333333333333333333',
        },
      })
    })
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(writePresentationMock).toHaveBeenCalledOnce()
    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-333333333333333333333',
        },
      }),
    )
  })

  test('consumes background persistence failures', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    writePresentationMock.mockRejectedValueOnce(new Error('native write failed'))

    renderInJsdom(<Harness routedWorkspaceId={repo.id} />)
    await Promise.resolve()

    expect(writePresentationMock).toHaveBeenCalledOnce()
  })

  test('persists A-B-A transitions while the B write is still pending', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a' } })],
      currentBranchName: 'feature/a',
    })
    useWorkspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      zenMode: false,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    let resolveFirstWrite!: () => void
    writePresentationMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstWrite = resolve
          }),
      )
      .mockImplementation(() => new Promise<void>(() => {}))

    renderInJsdom(<Harness routedWorkspaceId={repo.id} />)
    expect(writePresentationMock).toHaveBeenCalledOnce()
    await act(async () => {
      resolveFirstWrite()
      await Promise.resolve()
    })

    act(() => useWorkspacesStore.setState({ zenMode: true }))
    act(() => useWorkspacesStore.setState({ zenMode: false }))

    expect(writePresentationMock).toHaveBeenCalledTimes(3)
    expect(writePresentationMock.mock.calls.map(([state]) => state.zenMode)).toEqual([false, true, false])
  })
})

function Harness({ routedWorkspaceId = null }: { routedWorkspaceId?: WorkspaceId | null }) {
  useClientWorkspacePersistence({ routedWorkspaceId })
  return null
}
