import { beforeEach, describe, expect, test } from 'vitest'
import { replaceRepo } from '#/web/stores/repos/helpers.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab, RepoState } from '#/web/stores/repos/types.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_DETAIL_PANE_SIZES } from '#/shared/workspace-layout.ts'
const REPO_ID = '/tmp/gbl-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  detailTab?: DetailTab
  branches?: BranchSnapshotInfo[]
}) {
  seedRepoState({
    id: REPO_ID,
    branches: options.branches ?? [
      branch('main', { worktree: { path: '/repo' } }),
      branch('feature/worktree', { worktree: { path: '/tmp/feature-worktree' } }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    selectedBranch: options.selectedBranch ?? 'feature/plain',
    detailTab: options.detailTab ?? 'status',
    remote: {
      remotes: ['origin'],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  })
}

function updateRepoForTest(mutator: (repo: RepoState) => void) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function stubRefreshActions(
  stubs: Partial<Pick<ReturnType<typeof useReposStore.getState>, 'refreshPullRequests' | 'refreshStatus'>>,
): () => void {
  const original = useReposStore.getState()
  useReposStore.setState(stubs)
  return () => {
    useReposStore.setState({
      refreshPullRequests: original.refreshPullRequests,
      refreshStatus: original.refreshStatus,
    })
  }
}

beforeEach(() => {
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(ipcHandlers)
  ipcHandlers['repo.pullRequests'] = async () => []
  ipcHandlers['repo.status'] = async () => []
})

describe('setBranchViewMode', () => {
  test('changes the selected branch when the previous selection is hidden', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(useReposStore.getState().restorableRepoCache[REPO_ID]?.ui).toMatchObject({
      branchViewMode: 'worktrees',
      selectedBranch: 'main',
    })
  })

  test('keeps the selected branch when it remains visible', () => {
    seedRepo({ selectedBranch: 'feature/worktree' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/worktree')
  })

  test('clears the selection when the new view mode has no visible branches', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(repo?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().restorableRepoCache[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('passes the current repo token to follow-up refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'status' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('refreshes pull request details when the selected branch changes', async () => {
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    ipcHandlers['repo.pullRequests'] = async ({ branches, mode }: { branches?: string[]; mode?: string }) => {
      calls.push({ branches, mode: mode })
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')
    await flushAsyncWork()

    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
  })

  test('preserves the terminal preference when the view mode hides the active worktree branch', () => {
    // The store only re-picks the visible branch — the preferred tab is
    // never re-projected. The UI hook decides what's actually renderable.
    seedRepo({
      selectedBranch: 'main',
      detailTab: 'terminal',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'no-worktree')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.preferredDetailTab).toBe('terminal')
  })
})

describe('selectBranch', () => {
  test('refreshes pull request details locally', async () => {
    let resolve!: () => void
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    ipcHandlers['repo.pullRequests'] = ({ branches, mode }: { branches?: string[]; mode?: string }) =>
      new Promise<[]>((r) => {
        calls.push({ branches, mode })
        resolve = () => r([])
      })
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('loading')
    resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
    expect(useReposStore.getState().restorableRepoCache[REPO_ID]?.ui.selectedBranch).toBe('main')
  })

  test('passes the current repo token to selected branch refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'status' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().selectBranch(REPO_ID, 'main')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('ignores a branch that is not in the current snapshot', () => {
    let calls = 0
    ipcHandlers['repo.pullRequests'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'missing')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(calls).toBe(0)
  })

  test('does not refresh when selecting the already-selected branch', () => {
    let calls = 0
    ipcHandlers['repo.pullRequests'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/plain')
    expect(calls).toBe(0)
  })

  test('preserves the terminal preference when selecting a branch without a worktree', () => {
    // selectBranch updates `selectedBranch` only; the preferred tab is
    // preserved verbatim. The UI hook resolves the effective tab from
    // the active branch's worktree and the terminal session count.
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'terminal' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.preferredDetailTab).toBe('terminal')
  })
})

describe('setDetailTab', () => {
  test('persists the selected detail tab immediately', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
  })

  test('does not refresh when reselecting the current tab', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'status' })
    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().setDetailTab(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('changes')
  })

  test('passes the current repo token to detail tab refreshes', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'terminal' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setDetailTab(REPO_ID, 'status')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('refreshes pull request details when switching to status', async () => {
    const calls: string[][] = []
    ipcHandlers['repo.pullRequests'] = async ({ branches }: { branches?: string[] }) => {
      calls.push(branches ?? [])
      return []
    }
    seedRepo({ selectedBranch: 'main', detailTab: 'terminal' })

    useReposStore.getState().setDetailTab(REPO_ID, 'status')
    await flushAsyncWork()

    expect(calls).toEqual([['main']])
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setDetailTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time by `computeEffectiveDetailTab`,
    // which inspects the active branch's worktree + terminal session count.
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'terminal' })
    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
  })
})

describe('setWorkspaceLayout', () => {
  test('allows detail collapse changes in top-bottom layout', () => {
    useReposStore.getState().setDetailCollapsed(false)
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().setDetailCollapsed(true)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('expands detail and blocks collapse in left-right layout', () => {
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setWorkspaceLayout('left-right')

    expect(useReposStore.getState().workspaceLayout).toBe('left-right')
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().setDetailCollapsed(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().toggleDetailCollapsed()
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('allows collapse again after returning to top-bottom layout', () => {
    useReposStore.getState().setWorkspaceLayout('left-right')
    useReposStore.getState().setWorkspaceLayout('top-bottom')

    useReposStore.getState().toggleDetailCollapsed()

    expect(useReposStore.getState().workspaceLayout).toBe('top-bottom')
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('applies session layout state atomically with shared normalization rules', () => {
    useReposStore.getState().applySessionLayoutState({
      workspaceLayout: 'left-right',
      detailCollapsed: true,
      detailFocusMode: true,
      detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
    })

    expect(useReposStore.getState()).toMatchObject({
      workspaceLayout: 'left-right',
      detailCollapsed: false,
      detailFocusMode: false,
      detailPaneSizes: { 'top-bottom': 55, 'left-right': 45 },
    })
  })
})

describe('setDetailFocusMode', () => {
  test('enables focus mode and expands detail in top-bottom layout', () => {
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setDetailFocusMode(true)

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('keeps focus mode when detail is collapsed', () => {
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setDetailCollapsed(true)

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('exits focus mode without expanding a collapsed detail panel', () => {
    useReposStore.getState().setDetailFocusMode(true)
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setDetailFocusMode(false)

    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('re-expands into focus mode when focus is enabled while collapsed', () => {
    useReposStore.getState().setDetailFocusMode(true)
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().toggleDetailCollapsed()

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('exits focus mode when switching to left-right layout', () => {
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setWorkspaceLayout('left-right')

    expect(useReposStore.getState().workspaceLayout).toBe('left-right')
    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('does not enable focus mode in left-right layout', () => {
    useReposStore.getState().setWorkspaceLayout('left-right')

    useReposStore.getState().setDetailFocusMode(true)

    expect(useReposStore.getState().detailFocusMode).toBe(false)
  })

  test('preserves focus preference when filtering leaves no selected branch', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })
})

describe('setDetailPaneSize', () => {
  test('stores detail pane sizes per workspace layout', () => {
    useReposStore.getState().setDetailPaneSize('top-bottom', 37.34)
    useReposStore.getState().setDetailPaneSize('left-right', 72.28)

    expect(useReposStore.getState().detailPaneSizes).toEqual({ 'top-bottom': 37.3, 'left-right': 72.3 })
  })

  test('normalizes invalid and out-of-range sizes', () => {
    useReposStore.getState().setDetailPaneSize('top-bottom', Number.NaN)
    useReposStore.getState().setDetailPaneSize('left-right', 200)

    expect(useReposStore.getState().detailPaneSizes).toEqual({
      'top-bottom': DEFAULT_DETAIL_PANE_SIZES['top-bottom'],
      'left-right': 90,
    })
  })
})

describe('resetLayout', () => {
  test('restores the initial workspace layout defaults', () => {
    useReposStore.setState({
      workspaceLayout: 'left-right',
      detailCollapsed: false,
      detailFocusMode: true,
      detailPaneSizes: { 'top-bottom': 35, 'left-right': 70 },
    })

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState().workspaceLayout).toBe('top-bottom')
    expect(useReposStore.getState().detailCollapsed).toBe(true)
    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailPaneSizes).toBe(DEFAULT_DETAIL_PANE_SIZES)
  })

  test('is idempotent when layout is already at defaults', () => {
    const before = useReposStore.getState()

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState()).toBe(before)
  })
})

describe('setBranchSearchQuery', () => {
  test('updates runtime search without rewriting durable cache or changing selection', () => {
    seedRepo({ selectedBranch: 'feature/plain' })
    const repo = useReposStore.getState().repos[REPO_ID]!
    const cached = {
      savedAt: 123,
      name: repo.name,
      data: {
        branches: repo.data.branches,
        currentBranch: repo.data.currentBranch,
        status: repo.data.status,
        statusLoaded: repo.data.statusLoaded,
        worktreesByPath: repo.data.worktreesByPath,
      },
      ui: {
        selectedBranch: repo.ui.selectedBranch,
        branchViewMode: repo.ui.branchViewMode,
      },
    }
    useReposStore.setState({ restorableRepoCache: { [REPO_ID]: cached } })

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'worktree')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBe('worktree')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/plain')
    expect(useReposStore.getState().restorableRepoCache[REPO_ID]).toBe(cached)
  })

  test('removes runtime search when the query is cleared or the repo is closed', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'worktree')
    useReposStore.getState().setBranchSearchQuery(REPO_ID, '')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()

    useReposStore.getState().setBranchSearchQuery(REPO_ID, '   ')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'feature')
    useReposStore.getState().closeRepo(REPO_ID)

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()
  })
})
