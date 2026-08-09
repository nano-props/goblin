// @vitest-environment jsdom

import {
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { workspaceLocatorForPath, type WorkspaceId } from '#/shared/workspace-locator.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { useClientWorkspacePersistence } from '#/web/hooks/useClientWorkspacePersistence.ts'
import { filetreeInteractionStore } from '#/web/stores/workspaces/filetree-interaction-state.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

const writePresentationMock = vi.fn()

vi.mock('#/web/client-workspace-state.ts', () => ({
  writeClientWorkspaceState: (presentation: unknown) => writePresentationMock(presentation),
}))

beforeEach(() => {
  resetWorkspacesStore()
  filetreeInteractionStore.setState({ interactionByScope: {} })
  writePresentationMock.mockReset()
})

describe('useClientWorkspacePersistence', () => {
  test('persists client-owned workspace state without canonical tabs', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
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

  test('persists the routed workspace identity before its store projection is hydrated', async () => {
    const routedWorkspaceId = workspaceIdForTest('goblin+file:///tmp/routed-workspace')
    workspacesStore.setState({
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

  test('persists terminal selection, preferred tab, and filetree presentation', async () => {
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
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: worktreePath, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/worktree': [workspacePaneStaticTabEntry('history')] },
    })
    workspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      selectedTerminalSessionIdByTerminalFilesystemTarget: {
        [terminalFilesystemTargetKey]: 'term-111111111111111111111',
      },
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    filetreeInteractionStore.getState().restoreViewState({
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

  test('does not persist before workspace restore converges', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      workspaceMembershipReady: true,
      sessionPersistenceReady: false,
    })

    renderInJsdom(<Harness />)
    expect(writePresentationMock).not.toHaveBeenCalled()
  })

  test('debounces high-frequency presentation changes to the latest state', async () => {
    useFakeTimers()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    renderInJsdom(<Harness />)
    writePresentationMock.mockClear()

    await flushTestUpdates(() => {
      workspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-111111111111111111111',
        },
      })
      workspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-222222222222222222222',
        },
      })
    })
    await flushTestUpdates(() => {
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

  test('debounces a branch view mode change even when it is the only presentation change', async () => {
    useFakeTimers()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    renderInJsdom(<Harness />)
    writePresentationMock.mockClear()

    await flushTestUpdates(() => {
      workspacesStore.getState().setBranchViewMode(repo.id, 'worktrees')
    })
    await flushTestUpdates(() => {
      vi.advanceTimersByTime(200)
    })

    expect(writePresentationMock).toHaveBeenCalledOnce()
    expect(writePresentationMock).toHaveBeenCalledWith(
      expect.objectContaining({ branchViewModeByWorkspace: { [repo.id]: 'worktrees' } }),
    )
  })

  test('flushes a pending local presentation synchronously on pagehide', async () => {
    useFakeTimers()
    const repo = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/repo',
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
      workspaces: { [repo.id]: repo },
      workspaceOrder: [repo.id],
      restoredWorkspaceId: repo.id,
      workspaceMembershipReady: true,
      sessionPersistenceReady: true,
    })
    renderInJsdom(<Harness />)
    writePresentationMock.mockClear()

    await flushTestUpdates(() => {
      workspacesStore.setState({
        selectedTerminalSessionIdByTerminalFilesystemTarget: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/a': 'term-333333333333333333333',
        },
      })
    })
    await flushTestUpdates(() => {
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
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
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
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: '/tmp/a', isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: 'feature/a',
    })
    workspacesStore.setState({
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
    await flushTestUpdates(async () => {
      resolveFirstWrite()
      await Promise.resolve()
    })

    await flushTestUpdates(() => workspacesStore.setState({ zenMode: true }))
    await flushTestUpdates(() => workspacesStore.setState({ zenMode: false }))

    expect(writePresentationMock).toHaveBeenCalledTimes(3)
    expect(writePresentationMock.mock.calls.map(([state]) => state.zenMode)).toEqual([false, true, false])
  })
})

const Harness = defineComponent<{ routedWorkspaceId?: WorkspaceId | null }>({
  name: 'ClientWorkspacePersistenceTestHarness',
  props: ['routedWorkspaceId'],
  setup(props) {
    useClientWorkspacePersistence({ routedWorkspaceId: () => props.routedWorkspaceId ?? null })
    return () => null
  },
})
