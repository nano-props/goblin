// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { isRepoStatusRefreshable, useRepoStatusRefresh } from '#/web/hooks/useRepoStatusRefresh.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore } from '#/web/test-utils/bridge.ts'
import { preferredWorkspacePaneTabByTargetRecordWith } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setRepoSnapshotQueryData, setRepoStatusQueryData } from '#/web/repo-data-query.ts'

const originalRefreshRuntimeProjection = useReposStore.getState().refreshRuntimeProjection

function Harness({
  repoId = '/repo-a',
  branchName = 'main',
}: { repoId?: string | null; branchName?: string | null } = {}) {
  useRepoStatusRefresh({ hydratedRouteRepoId: repoId, currentBranchName: branchName })
  return null
}

function createRepo(
  id: string,
  options: {
    preferredWorkspacePaneTab?: WorkspacePaneTabType
    /**
     * Phase 4: the legacy `availability.phase` field is gone for
     * remote repos. The snapshot's `unavailable` boolean is
     * computed by `isRepoUnavailable(repo)`. For local repos
     * (which these tests are about), the field is set via
     * `availability.phase`. The factory below just routes the
     * test's intent through whichever legacy field still works
     * — the snapshot tests don't care which storage the
     * boolean came from.
     */
    unavailable?: boolean
    statusPhase?: 'idle' | 'loading' | 'refreshing'
  } = {},
) {
  const repo = emptyRepo(id, 'repo', 'repo-instance-test')
  const worktreePath = `${id}/main`
  const branches = [createRepoBranch('main', { worktree: { path: worktreePath } })]
  repo.instanceId = id === '/repo-a' ? 'repo-instance-test-a' : 'repo-instance-test-b'
  setRepoSnapshotQueryData(id, repo.instanceId, {
    current: 'main',
    branches,
  })
  setRepoStatusQueryData(id, repo.instanceId, [])
  setWorkspacePaneTabsForTargetQueryData({
    repoRoot: id,
    repoInstanceId: repo.instanceId,
    branchName: 'main',
    worktreePath,
    tabs: [workspacePaneStaticTabEntry('status')],
  })
  repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
    repo.ui,
    { repoRoot: id, branchName: 'main', worktreePath },
    options.preferredWorkspacePaneTab ?? 'status',
  )
  if (options.unavailable) repo.availability = { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: 0 }
  repo.dataLoads.status.phase = options.statusPhase ?? 'idle'
  return repo
}

describe('isRepoStatusRefreshable', () => {
  test('returns true for an idle, available repo', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'idle',
      }),
    ).toBe(true)
  })

  test('returns false when availability is unavailable', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: true,
        statusPhase: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when a refresh is already in flight', () => {
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'loading',
      }),
    ).toBe(false)
    expect(
      isRepoStatusRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        statusViewOpen: true,
        unavailable: false,
        statusPhase: 'refreshing',
      }),
    ).toBe(false)
  })
})

describe('useRepoStatusRefresh', () => {
  let container: HTMLDivElement
  let root: Root
  let refreshRuntimeProjection: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    resetReposStore()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    refreshRuntimeProjection = vi.fn().mockResolvedValue(undefined)
    useReposStore.setState({
      refreshRuntimeProjection: refreshRuntimeProjection as typeof originalRefreshRuntimeProjection,
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    resetReposStore()
    useReposStore.setState({ refreshRuntimeProjection: originalRefreshRuntimeProjection })
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  test('refreshes status when switching to another current repo', async () => {
    const repoA = createRepo('/repo-a')
    const repoB = createRepo('/repo-b')
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repoA, '/repo-b': repoB },
        order: ['/repo-a', '/repo-b'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness repoId="/repo-a" />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      root.render(<Harness repoId="/repo-b" />)
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-b', {
      repoInstanceId: 'repo-instance-test-b',
      sections: ['status'],
    })
  })

  test('refreshes status when opening the status tab', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'terminal' })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'status')
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      sections: ['status'],
    })
  })

  test('refreshes status when opening the changes tab', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'terminal' })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'changes')
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      sections: ['status'],
    })
  })

  test('refreshes status when reopening the status tab after bouncing through terminal', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'status' })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'terminal')
    })
    expect(refreshRuntimeProjection).not.toHaveBeenCalled()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'status')
    })
    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      sections: ['status'],
    })
  })

  test('skips refresh when the repo is unavailable', async () => {
    const repo = createRepo('/repo-a', { unavailable: true })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'status')
    })

    expect(refreshRuntimeProjection).not.toHaveBeenCalled()
  })

  test('skips refresh when a status refresh is already in flight', async () => {
    const repo = createRepo('/repo-a', { statusPhase: 'loading' })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'status')
    })

    expect(refreshRuntimeProjection).not.toHaveBeenCalled()
  })

  test('does not treat branch selection changes as refresh triggers', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'status' })
    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness />)
    })
    refreshRuntimeProjection.mockClear()

    expect(refreshRuntimeProjection).not.toHaveBeenCalled()
  })
})
