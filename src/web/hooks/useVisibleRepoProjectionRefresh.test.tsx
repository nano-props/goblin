// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  isRepoVisibleProjectionRefreshable,
  useVisibleRepoProjectionRefresh,
} from '#/web/hooks/useVisibleRepoProjectionRefresh.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoReadModelQueryData } from '#/web/test-utils/bridge.ts'
import { preferredWorkspacePaneTabByTargetRecordWith } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

const originalRefreshRuntimeProjection = useReposStore.getState().refreshRuntimeProjection

function Harness({
  repoId = '/repo-a',
  branchName = 'main',
}: { repoId?: string | null; branchName?: string | null } = {}) {
  useVisibleRepoProjectionRefresh({ hydratedRouteRepoId: repoId, currentBranchName: branchName })
  return null
}

function createRepo(
  id: string,
  options: {
    preferredWorkspacePaneTab?: WorkspacePaneTabType
    branchNames?: string[]
    /**
     * Phase 4: the legacy `availability.phase` field is gone for
     * remote repos. The refresh state's `unavailable` boolean is
     * computed by `isRepoUnavailable(repo)`. For local repos
     * (which these tests are about), the field is set via
     * `availability.phase`. The factory below just routes the
     * test's intent through whichever legacy field still works
     * — these projection-refresh tests don't care which storage the
     * boolean came from.
     */
    unavailable?: boolean
    visibleStatusPhase?: 'idle' | 'loading' | 'refreshing'
  } = {},
) {
  const repo = emptyRepo(id, 'repo', 'repo-instance-test')
  const branchNames = options.branchNames ?? ['main']
  const branches = branchNames.map((branchName) => {
    const worktreePath = `${id}/${branchName.replaceAll('/', '-')}`
    return createRepoBranch(branchName, { worktree: { path: worktreePath } })
  })
  repo.instanceId = id === '/repo-a' ? 'repo-instance-test-a' : 'repo-instance-test-b'
  seedRepoReadModelQueryData(repo, { branches, currentBranch: 'main', status: [] })
  for (const branch of branches) {
    const worktreePath = branch.worktree?.path
    if (!worktreePath) continue
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: id,
      repoInstanceId: repo.instanceId,
      branchName: branch.name,
      worktreePath,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
      repo.ui,
      { repoRoot: id, branchName: branch.name, worktreePath },
      options.preferredWorkspacePaneTab ?? 'status',
    )
  }
  if (options.unavailable) repo.availability = { phase: 'unavailable', reason: 'error.failed-read-repo', checkedAt: 0 }
  repo.dataLoads.visibleStatus.phase = options.visibleStatusPhase ?? 'idle'
  return repo
}

describe('isRepoVisibleProjectionRefreshable', () => {
  test('returns true for an idle, available repo', () => {
    expect(
      isRepoVisibleProjectionRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        branchName: 'main',
        visibleProjectionViewOpen: true,
        unavailable: false,
        visibleStatusPhase: 'idle',
      }),
    ).toBe(true)
  })

  test('returns false when availability is unavailable', () => {
    expect(
      isRepoVisibleProjectionRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        branchName: 'main',
        visibleProjectionViewOpen: true,
        unavailable: true,
        visibleStatusPhase: 'idle',
      }),
    ).toBe(false)
  })

  test('returns false when a refresh is already in flight', () => {
    expect(
      isRepoVisibleProjectionRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        branchName: 'main',
        visibleProjectionViewOpen: true,
        unavailable: false,
        visibleStatusPhase: 'loading',
      }),
    ).toBe(false)
    expect(
      isRepoVisibleProjectionRefreshable({
        id: '/r',
        repoInstanceId: 'repo-instance-test',
        preferredWorkspacePaneTab: 'status',
        branchName: 'main',
        visibleProjectionViewOpen: true,
        unavailable: false,
        visibleStatusPhase: 'refreshing',
      }),
    ).toBe(false)
  })
})

describe('useVisibleRepoProjectionRefresh', () => {
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

  test('refreshes the visible projection when switching to another current repo', async () => {
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
      scope: 'visible-status',
      branchName: 'main',
    })
  })

  test('refreshes the visible projection when opening the status tab', async () => {
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
      scope: 'visible-status',
      branchName: 'main',
    })
  })

  test('refreshes the visible projection when opening the changes tab', async () => {
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
      scope: 'visible-status',
      branchName: 'main',
    })
  })

  test('refreshes the visible projection when reopening the status tab after bouncing through terminal', async () => {
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
      scope: 'visible-status',
      branchName: 'main',
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

  test('skips refresh when a visible projection refresh is already in flight', async () => {
    const repo = createRepo('/repo-a', { visibleStatusPhase: 'loading' })
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

  test('refreshes the visible projection when switching branches in the current repo', async () => {
    const repo = createRepo('/repo-a', { preferredWorkspacePaneTab: 'status', branchNames: ['main', 'feature/a'] })
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
      root.render(<Harness branchName="feature/a" />)
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      scope: 'visible-status',
      branchName: 'feature/a',
    })
  })
})
