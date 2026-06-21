import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceRepo } from '#/web/stores/repos/helpers.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_FOCUSED, DEFAULT_WORKSPACE_PANE_SIZES } from '#/shared/workspace-layout.ts'
const REPO_ID = '/tmp/gbl-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  workspacePaneView?: WorkspacePaneView
  openBranchWorkspacePaneViews?: WorkspacePaneBranchViewType[]
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
    selectedBranch: options.selectedBranch === undefined ? 'feature/plain' : options.selectedBranch,
    workspacePaneView: options.workspacePaneView ?? 'status',
    openBranchWorkspacePaneViews: options.openBranchWorkspacePaneViews,
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
    seedRepo({ selectedBranch: 'feature/plain', workspacePaneView: 'status' })
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

  test('preserves the terminal preference when the view mode hides the active branch', () => {
    // The store only re-picks the visible branch — the preferred tab is
    // never re-projected. The UI hook decides what's actually renderable.
    seedRepo({
      selectedBranch: 'feature/plain',
      workspacePaneView: 'terminal',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(repo?.ui.preferredWorkspacePaneView).toBe('terminal')
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
    seedRepo({ selectedBranch: 'feature/plain', workspacePaneView: 'status' })
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
    seedRepo({ selectedBranch: 'feature/worktree', workspacePaneView: 'terminal' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.preferredWorkspacePaneView).toBe('terminal')
  })
})

describe('clearSelectedBranch', () => {
  test('clears selection, persists the empty selection, and skips pull request refresh', async () => {
    let calls = 0
    ipcHandlers['repo.pullRequests'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().clearSelectedBranch(REPO_ID)
    await flushAsyncWork()

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().restorableRepoCache[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(calls).toBe(0)
  })

  test('does nothing when there is no selected branch', () => {
    seedRepo({ selectedBranch: null })
    const before = useReposStore.getState().repos[REPO_ID]

    useReposStore.getState().clearSelectedBranch(REPO_ID)

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })
})

describe('setWorkspacePaneView', () => {
  test('persists the selected workspace pane view immediately', () => {
    seedRepo({ selectedBranch: 'feature/worktree', workspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('terminal')
  })

  test('does not refresh when reselecting the current tab', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'status' })
    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('opens the branch-level status view when reselecting a closed status tab', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'status' })
    useReposStore.getState().closeBranchWorkspacePaneView(REPO_ID, 'status')

    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'status')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['status'])
  })

  test('opens restored branch-level history during session restore', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'status', openBranchWorkspacePaneViews: ['status'] })

    useReposStore.getState().applySessionWorkspacePaneViewByRepo({ [REPO_ID]: 'history' })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('history')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['status', 'history'])
  })

  test('reopens restored branch-level history even when it was already preferred', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'history', openBranchWorkspacePaneViews: ['status'] })

    useReposStore.getState().applySessionWorkspacePaneViewByRepo({ [REPO_ID]: 'history' })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['status', 'history'])
  })

  test('opens and closes branch-level workspace pane views independently of branch selection', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'status' })

    useReposStore.getState().closeBranchWorkspacePaneView(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual([])

    useReposStore.getState().openBranchWorkspacePaneView(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['status'])
  })

  test('reorders branch-level workspace pane views without changing the open set', () => {
    seedRepo({
      selectedBranch: 'main',
      workspacePaneView: 'history',
      openBranchWorkspacePaneViews: ['status', 'history'],
    })

    useReposStore.getState().reorderBranchWorkspacePaneViews(REPO_ID, ['history', 'status'])

    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['history', 'status'])

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().reorderBranchWorkspacePaneViews(REPO_ID, ['history'])
    useReposStore.getState().reorderBranchWorkspacePaneViews(REPO_ID, ['history', 'history'])
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('changes')
  })

  test('passes the current repo token to workspace pane view refreshes', () => {
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'terminal' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setWorkspacePaneView(REPO_ID, 'status')

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
    seedRepo({ selectedBranch: 'main', workspacePaneView: 'terminal' })

    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'status')
    await flushAsyncWork()

    expect(calls).toEqual([['main']])
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setWorkspacePaneView is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane views.
    seedRepo({ selectedBranch: 'feature/plain', workspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ selectedBranch: 'feature/plain', workspacePaneView: 'terminal' })
    useReposStore.getState().setWorkspacePaneView(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('terminal')
  })
})

describe('workspace pane layout state', () => {
  test('applies session pane state atomically with shared normalization rules', () => {
    useReposStore.getState().applySessionLayoutState({
      workspaceFocused: true,
      workspacePaneSizes: { 'left-right': 45 },
    })

    expect(useReposStore.getState()).toMatchObject({
      workspaceFocused: true,
      workspacePaneSizes: { 'left-right': 45 },
    })
  })
})

describe('setWorkspaceFocused', () => {
  test('enables large-screen Focus Mode', () => {
    useReposStore.getState().setWorkspaceFocused(true)

    expect(useReposStore.getState().workspaceFocused).toBe(true)
  })

  test('can disable large-screen Focus Mode again', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().setWorkspaceFocused(false)

    expect(useReposStore.getState().workspaceFocused).toBe(false)
  })

  test('toggles large-screen Focus Mode', () => {
    useReposStore.getState().toggleWorkspaceFocused()

    expect(useReposStore.getState().workspaceFocused).toBe(true)
  })

  test('preserves large-screen Focus Mode when filtering leaves no selected branch', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })
    useReposStore.getState().setWorkspaceFocused(true)

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().workspaceFocused).toBe(true)
  })
})

describe('setWorkspacePaneSize', () => {
  test('stores the workspace pane size for the left-right layout', () => {
    useReposStore.getState().setWorkspacePaneSize('left-right', 72.28)

    expect(useReposStore.getState().workspacePaneSizes).toEqual({ 'left-right': 72.3 })
  })

  test('normalizes invalid and out-of-range sizes', () => {
    useReposStore.getState().setWorkspacePaneSize('left-right', 200)

    expect(useReposStore.getState().workspacePaneSizes).toEqual({
      'left-right': 90,
    })
  })
})

describe('resetLayout', () => {
  test('restores the initial workspace layout defaults', () => {
    useReposStore.setState({
      workspaceFocused: true,
      workspacePaneSizes: { 'left-right': 70 },
    })

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState().workspaceFocused).toBe(DEFAULT_WORKSPACE_FOCUSED)
    expect(useReposStore.getState().workspacePaneSizes).toBe(DEFAULT_WORKSPACE_PANE_SIZES)
  })

  test('is idempotent when layout is already at defaults', () => {
    const before = useReposStore.getState()

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState()).toBe(before)
  })
})
