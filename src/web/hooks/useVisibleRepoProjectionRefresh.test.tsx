// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
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
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue, TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { BranchSnapshotInfo, WorktreeStatus } from '#/web/types.ts'

const originalRefreshRuntimeProjection = useReposStore.getState().refreshRuntimeProjection
const emptyTerminalWorktreeSnapshots = new Map<string, TerminalWorktreeSnapshot>()
const emptyTerminalSnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
const emptyTerminalWorktreeSnapshot = (terminalWorktreeKey: string): TerminalWorktreeSnapshot => {
  let snapshot = emptyTerminalWorktreeSnapshots.get(terminalWorktreeKey)
  if (!snapshot) {
    snapshot = {
      terminalWorktreeKey,
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }
    emptyTerminalWorktreeSnapshots.set(terminalWorktreeKey, snapshot)
  }
  return snapshot
}
const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: emptyTerminalWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => emptyTerminalSnapshot,
  subscribeSnapshot: () => () => {},
}

function Harness({
  repoId = '/repo-a',
  branchName = 'main',
}: { repoId?: string | null; branchName?: string | null } = {}) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <TerminalSessionReadContext value={terminalReadContext}>
        <HarnessEffect repoId={repoId} branchName={branchName} />
      </TerminalSessionReadContext>
    </QueryClientProvider>
  )
}

function HarnessEffect({ repoId, branchName }: { repoId: string | null; branchName: string | null }) {
  useVisibleRepoProjectionRefresh({ hydratedRouteRepoId: repoId, currentBranchName: branchName })
  return null
}

function seedBranchScopedReadModelQueryData(
  repo: Pick<RepoState, 'id' | 'instanceId'>,
  branchName: string,
  branches: BranchSnapshotInfo[],
  status: WorktreeStatus[] = [],
): void {
  setRepoProjectionQueryData(repo.id, repo.instanceId, branchName, 'full', {
    snapshot: {
      branches,
      current: branchName,
    },
    status,
    pullRequests: null,
    operations: { operations: [], loadedAt: 0 },
    requested: {
      branch: branchName,
      pullRequestMode: 'full',
    },
    loadedAt: 0,
  })
}

function setVisibleStatusPhase(repoId: string, phase: 'idle' | 'loading' | 'refreshing'): void {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) throw new Error(`repo not found: ${repoId}`)
  useReposStore.setState({
    repos: {
      ...state.repos,
      [repoId]: {
        ...repo,
        dataLoads: {
          ...repo.dataLoads,
          visibleStatus: {
            ...repo.dataLoads.visibleStatus,
            phase,
          },
        },
      },
    },
  })
}

function createRepo(
  id: string,
  options: {
    preferredWorkspacePaneTab?: WorkspacePaneTabType
    branchNames?: string[]
    workspacePaneTabs?: WorkspacePaneTabEntry[]
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
  for (const branch of branches) seedBranchScopedReadModelQueryData(repo, branch.name, branches)
  for (const branch of branches) {
    const worktreePath = branch.worktree?.path
    if (!worktreePath) continue
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: id,
      repoInstanceId: repo.instanceId,
      branchName: branch.name,
      worktreePath,
      tabs: options.workspacePaneTabs ?? [workspacePaneStaticTabEntry('status')],
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
        renderedWorkspacePaneTab: 'status',
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
        renderedWorkspacePaneTab: 'status',
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
        renderedWorkspacePaneTab: 'status',
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
        renderedWorkspacePaneTab: 'status',
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
    primaryWindowQueryClient.clear()
    emptyTerminalWorktreeSnapshots.clear()
    useTerminalProjectionHydrationStore.setState({
      hydrationByRepo: new Map(),
      refreshedAtByRepo: new Map(),
    })
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
    primaryWindowQueryClient.clear()
    useTerminalProjectionHydrationStore.setState({
      hydrationByRepo: new Map(),
      refreshedAtByRepo: new Map(),
    })
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
    const repo = createRepo('/repo-a', {
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabs: [workspacePaneStaticTabEntry('history')],
    })
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
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: '/repo-a',
        repoInstanceId: 'repo-instance-test-a',
        branchName: 'main',
        worktreePath: '/repo-a/main',
        tabs: [workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('status')],
      })
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'status')
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      scope: 'visible-status',
      branchName: 'main',
    })
  })

  test('refreshes the visible projection when opening the changes tab', async () => {
    const repo = createRepo('/repo-a', {
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabs: [workspacePaneStaticTabEntry('history')],
    })
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
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: '/repo-a',
        repoInstanceId: 'repo-instance-test-a',
        branchName: 'main',
        worktreePath: '/repo-a/main',
        tabs: [workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('changes')],
      })
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'changes')
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      scope: 'visible-status',
      branchName: 'main',
    })
  })

  test('refreshes the visible projection when reopening the status tab after bouncing through history', async () => {
    const repo = createRepo('/repo-a', {
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    })
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
      useReposStore.getState().setWorkspacePaneTab('/repo-a', 'main', 'history')
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

  test('uses the branch-scoped projection when resolving linked-worktree tab targets', async () => {
    const repo = emptyRepo('/repo-a', 'repo', 'repo-instance-test-a')
    repo.instanceId = 'repo-instance-test-a'
    const staleBranch = createRepoBranch('feature/a', { worktree: { path: '/repo-a/stale-worktree' } })
    const scopedBranch = createRepoBranch('feature/a', { worktree: { path: '/repo-a/live-worktree' } })
    seedRepoReadModelQueryData(repo, { branches: [staleBranch], currentBranch: 'feature/a', status: [] })
    seedBranchScopedReadModelQueryData(repo, 'feature/a', [scopedBranch])
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo-a',
      repoInstanceId: 'repo-instance-test-a',
      branchName: 'feature/a',
      worktreePath: '/repo-a/stale-worktree',
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: '/repo-a',
      repoInstanceId: 'repo-instance-test-a',
      branchName: 'feature/a',
      worktreePath: '/repo-a/live-worktree',
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
      repo.ui,
      { repoRoot: '/repo-a', branchName: 'feature/a', worktreePath: '/repo-a/stale-worktree' },
      'history',
    )
    repo.ui.preferredWorkspacePaneTabByTarget = preferredWorkspacePaneTabByTargetRecordWith(
      repo.ui,
      { repoRoot: '/repo-a', branchName: 'feature/a', worktreePath: '/repo-a/live-worktree' },
      'status',
    )

    await act(async () => {
      useReposStore.setState({
        repos: { '/repo-a': repo },
        order: ['/repo-a'],
        restoredRepoId: '/repo-a',
      })
      root.render(<Harness branchName="feature/a" />)
    })

    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      scope: 'visible-status',
      branchName: 'feature/a',
    })
  })

  test('refreshes the current branch after a busy visible refresh settles', async () => {
    const repo = createRepo('/repo-a', {
      preferredWorkspacePaneTab: 'status',
      branchNames: ['main', 'feature/a', 'feature/b'],
    })
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
    refreshRuntimeProjection.mockClear()

    await act(async () => {
      setVisibleStatusPhase('/repo-a', 'loading')
      root.render(<Harness branchName="feature/b" />)
    })
    expect(refreshRuntimeProjection).not.toHaveBeenCalled()

    await act(async () => {
      setVisibleStatusPhase('/repo-a', 'idle')
    })
    expect(refreshRuntimeProjection).toHaveBeenCalledWith('/repo-a', {
      repoInstanceId: 'repo-instance-test-a',
      scope: 'visible-status',
      branchName: 'feature/b',
    })
  })

  test('refreshes after branch switches when status is rendered through stale runtime tab fallback', async () => {
    const repo = createRepo('/repo-a', {
      preferredWorkspacePaneTab: 'terminal',
      branchNames: ['main', 'feature/a'],
      workspacePaneTabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-1')],
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady('/repo-a', 'repo-instance-test-a')
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
