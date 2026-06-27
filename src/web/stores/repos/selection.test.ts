import { beforeEach, describe, expect, test, vi } from 'vitest'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES, workspacePaneStaticTabOrderEntry } from '#/shared/workspace-pane.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import {
  workspacePaneStaticViewsForBranch,
  workspacePaneTabOrderForBranch,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
const REPO_ID = '/tmp/gbl-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  preferredWorkspacePaneView?: WorkspacePaneTabType
  workspacePaneStaticViews?: WorkspacePaneStaticTabType[]
  workspacePaneTabOrder?: WorkspacePaneTabOrderEntry[]
  branches?: BranchSnapshotInfo[]
}) {
  const selectedBranch = options.selectedBranch === undefined ? 'feature/plain' : options.selectedBranch
  seedRepoState({
    id: REPO_ID,
    branches: options.branches ?? [
      branch('main', { worktree: { path: '/repo' } }),
      branch('feature/worktree', { worktree: { path: '/tmp/feature-worktree' } }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    selectedBranch,
    preferredWorkspacePaneView: options.preferredWorkspacePaneView ?? 'status',
    workspacePaneTabOrderByBranch:
      selectedBranch && (options.workspacePaneTabOrder ?? options.workspacePaneStaticViews)
        ? {
            [selectedBranch]:
              options.workspacePaneTabOrder ?? staticTabOrder(...(options.workspacePaneStaticViews ?? [])),
          }
        : undefined,
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

function openViewsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticViewsForBranch(repo.ui, branchName) : []
}

function tabOrderFor(branchName: string): WorkspacePaneTabOrderEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneTabOrderForBranch(repo.ui, branchName) : []
}

function preferredViewFor(branchName?: string | null): WorkspacePaneTabType | null {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? preferredWorkspacePaneViewForBranch(repo.ui, branchName ?? repo.ui.selectedBranch) : null
}

function restoreWorkspacePaneState(restoreState: Partial<SessionWorkspacePaneRestoreState>) {
  const normalizedRestoreState: SessionWorkspacePaneRestoreState = {
    workspacePaneTabOrderByBranchByRepo: restoreState.workspacePaneTabOrderByBranchByRepo ?? {},
    preferredWorkspacePaneViewByBranchByRepo: restoreState.preferredWorkspacePaneViewByBranchByRepo ?? {},
  }
  useReposStore.setState((s) => {
    const repos = restoreSessionWorkspacePaneStateInRepos(s.repos, normalizedRestoreState)
    return repos === s.repos ? s : { repos }
  })
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function staticTabOrder(...views: WorkspacePaneStaticTabType[]): WorkspacePaneTabOrderEntry[] {
  return views.map((view) => workspacePaneStaticTabOrderEntry(view))
}

function terminalEntry(id: string): WorkspacePaneTabOrderEntry {
  return { type: 'terminal', id }
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
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneView: 'status' })
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

  test('keeps the hidden branch workspace pane selection on that branch', () => {
    seedRepo({
      selectedBranch: 'feature/plain',
      preferredWorkspacePaneView: 'terminal',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(preferredViewFor('feature/plain')).toBe('terminal')
    expect(preferredViewFor('main')).toBe('status')
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
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneView: 'status' })
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

  test('keeps workspace pane selection isolated when selecting another branch', () => {
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneView: 'terminal' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(preferredViewFor('feature/worktree')).toBe('terminal')
    expect(preferredViewFor('feature/plain')).toBe('status')
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

describe('setWorkspacePaneTab', () => {
  test('persists the selected workspace pane view immediately', () => {
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredViewFor('feature/worktree')).toBe('terminal')
  })

  test('does not refresh when reselecting the current workspace pane view', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status' })
    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('does not reopen a closed branch-level tab when only selecting its view', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status' })
    useReposStore.getState().closeWorkspacePaneStaticView(REPO_ID, 'status')

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')

    expect(openViewsFor('main')).toEqual([])
  })

  test('restores workspace pane tab order during session restore', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status', workspacePaneStaticViews: ['status'] })

    restoreWorkspacePaneState({
      workspacePaneTabOrderByBranchByRepo: { [REPO_ID]: { main: staticTabOrder('history') } },
    })

    expect(preferredViewFor('main')).toBe('status')
    expect(openViewsFor('main')).toEqual(['history'])
  })

  test('restores an explicitly empty workspace pane tab order during session restore', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status', workspacePaneStaticViews: ['status'] })

    restoreWorkspacePaneState({ workspacePaneTabOrderByBranchByRepo: { [REPO_ID]: { main: [] } } })

    expect(openViewsFor('main')).toEqual([])
  })

  test('preserves restored workspace pane tab order before branch snapshot is loaded', () => {
    seedRepo({ selectedBranch: null, branches: [] })

    restoreWorkspacePaneState({ workspacePaneTabOrderByBranchByRepo: { [REPO_ID]: { main: [] } } })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.workspacePaneTabOrderByBranch).toEqual({ main: [] })
  })

  test('does not restore a branch-level preferred view whose tab is closed', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status', workspacePaneStaticViews: ['status'] })

    restoreWorkspacePaneState({ preferredWorkspacePaneViewByBranchByRepo: { [REPO_ID]: { main: 'history' } } })

    expect(preferredViewFor('main')).toBe('status')
    expect(openViewsFor('main')).toEqual(['status'])
  })

  test('opens and closes static workspace pane tabs independently of branch selection', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status' })

    useReposStore.getState().closeWorkspacePaneStaticView(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(openViewsFor('main')).toEqual([])

    useReposStore.getState().openWorkspacePaneStaticView(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(openViewsFor('main')).toEqual(['status'])
  })

  test('reorders the unified workspace pane tab strip without changing the static open set', () => {
    seedRepo({
      selectedBranch: 'main',
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrder: [
        workspacePaneStaticTabOrderEntry('status'),
        terminalEntry('slot-1'),
        workspacePaneStaticTabOrderEntry('history'),
      ],
    })

    useReposStore
      .getState()
      .reorderWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabOrderEntry('history'),
        terminalEntry('slot-1'),
        workspacePaneStaticTabOrderEntry('status'),
      ])

    expect(openViewsFor('main')).toEqual(['history', 'status'])
    expect(tabOrderFor('main')).toEqual([
      workspacePaneStaticTabOrderEntry('history'),
      terminalEntry('slot-1'),
      workspacePaneStaticTabOrderEntry('status'),
    ])

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().reorderWorkspacePaneTabs(REPO_ID, [workspacePaneStaticTabOrderEntry('history')])
    useReposStore
      .getState()
      .reorderWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabOrderEntry('history'),
        workspacePaneStaticTabOrderEntry('history'),
      ])
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('adds a terminal tab at the end even when a stale entry already exists', () => {
    seedRepo({
      selectedBranch: 'main',
      workspacePaneTabOrder: [terminalEntry('slot-1'), workspacePaneStaticTabOrderEntry('status')],
    })

    useReposStore.getState().addWorkspacePaneTerminalTab(REPO_ID, 'slot-1')

    expect(tabOrderFor('main')).toEqual([workspacePaneStaticTabOrderEntry('status'), terminalEntry('slot-1')])
  })

  test('addAndFocus adds the tab, switches to terminal view, and selects the new terminal', () => {
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneView: 'status' })

    useReposStore.getState().addAndFocusWorkspacePaneTerminalTab(REPO_ID, 'slot-1')

    expect(tabOrderFor('feature/worktree')).toEqual([workspacePaneStaticTabOrderEntry('status'), terminalEntry('slot-1')])
    expect(preferredViewFor('feature/worktree')).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalByWorktree[`${REPO_ID}\0/tmp/feature-worktree`]).toBe('slot-1')
  })

  test('addAndFocus is a no-op when everything is already focused', () => {
    seedRepo({
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrder: [terminalEntry('slot-1')],
    })
    useReposStore.setState({
      selectedTerminalByWorktree: { [`${REPO_ID}\0/tmp/feature-worktree`]: 'slot-1' },
    })

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().addAndFocusWorkspacePaneTerminalTab(REPO_ID, 'slot-1')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('addAndFocus does nothing for a branch without a worktree', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneView: 'status' })

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().addAndFocusWorkspacePaneTerminalTab(REPO_ID, 'slot-1')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
    expect(preferredViewFor('feature/plain')).toBe('status')
  })

  test('removes a terminal tab order entry when its terminal closes', () => {
    seedRepo({
      selectedBranch: 'main',
      workspacePaneTabOrder: [
        workspacePaneStaticTabOrderEntry('status'),
        terminalEntry('slot-1'),
        workspacePaneStaticTabOrderEntry('history'),
      ],
    })

    useReposStore.getState().removeWorkspacePaneTerminalTab(REPO_ID, 'slot-1')

    expect(tabOrderFor('main')).toEqual([
      workspacePaneStaticTabOrderEntry('status'),
      workspacePaneStaticTabOrderEntry('history'),
    ])
  })

  test('reorders visible tabs while preserving hidden worktree-scoped static tabs', () => {
    const hiddenWorktreeEntries = WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES.map(workspacePaneStaticTabOrderEntry)
    seedRepo({
      selectedBranch: 'feature/plain',
      workspacePaneTabOrder: [
        workspacePaneStaticTabOrderEntry('status'),
        ...hiddenWorktreeEntries,
        workspacePaneStaticTabOrderEntry('history'),
      ],
    })

    useReposStore
      .getState()
      .reorderWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabOrderEntry('history'),
        workspacePaneStaticTabOrderEntry('status'),
      ])

    expect(tabOrderFor('feature/plain')).toEqual([
      workspacePaneStaticTabOrderEntry('history'),
      ...hiddenWorktreeEntries,
      workspacePaneStaticTabOrderEntry('status'),
    ])
  })

  test('keeps static workspace pane tabs isolated by branch', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().openWorkspacePaneStaticView(REPO_ID, 'history')

    expect(openViewsFor('feature/plain')).toEqual(['status', 'history'])
    expect(openViewsFor('main')).toEqual(['status'])

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(openViewsFor('main')).toEqual(['status'])
    expect(openViewsFor('feature/plain')).toEqual(['status', 'history'])
  })

  test('keeps selected workspace pane views isolated by branch', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'history')
    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(preferredViewFor('feature/plain')).toBe('history')
    expect(preferredViewFor('main')).toBe('status')

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')
    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    expect(preferredViewFor('main')).toBe('changes')
    expect(preferredViewFor('feature/plain')).toBe('history')
  })

  test('keeps an explicitly closed status tab closed on its branch', () => {
    seedRepo({ selectedBranch: 'main' })

    useReposStore.getState().closeWorkspacePaneStaticView(REPO_ID, 'status')
    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')
    useReposStore.getState().openWorkspacePaneStaticView(REPO_ID, 'status')

    expect(openViewsFor('feature/plain')).toEqual(['status'])
    expect(openViewsFor('main')).toEqual([])
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(preferredViewFor('main')).toBe('changes')
  })

  test('passes the current repo token to workspace pane view refreshes', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'terminal' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')

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
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneView: 'terminal' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')
    await flushAsyncWork()

    expect(calls).toEqual([['main']])
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setWorkspacePaneTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane views.
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneView: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredViewFor('feature/plain')).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneView: 'terminal' })
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredViewFor('feature/plain')).toBe('terminal')
  })
})

describe('workspace pane layout state', () => {
  test('applies session pane state atomically with shared normalization rules', () => {
    useReposStore.getState().applySessionLayoutState({
      zenMode: true,
      workspacePaneSize: 45,
    })

    expect(useReposStore.getState()).toMatchObject({
      zenMode: true,
      workspacePaneSize: 45,
    })
  })
})

describe('setZenMode', () => {
  test('enables large-screen Zen Mode', () => {
    useReposStore.getState().setZenMode(true)

    expect(useReposStore.getState().zenMode).toBe(true)
  })

  test('can disable large-screen Zen Mode again', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().setZenMode(false)

    expect(useReposStore.getState().zenMode).toBe(false)
  })

  test('toggles large-screen Zen Mode', () => {
    useReposStore.getState().toggleZenMode()

    expect(useReposStore.getState().zenMode).toBe(true)
  })

  test('preserves large-screen Zen Mode when filtering leaves no selected branch', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })
    useReposStore.getState().setZenMode(true)

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().zenMode).toBe(true)
  })
})

describe('setWorkspacePaneSize', () => {
  test('stores the workspace pane size', () => {
    useReposStore.getState().setWorkspacePaneSize(72.28)

    expect(useReposStore.getState().workspacePaneSize).toBe(72.3)
  })

  test('normalizes invalid and out-of-range sizes', () => {
    useReposStore.getState().setWorkspacePaneSize(200)

    expect(useReposStore.getState().workspacePaneSize).toBe(90)
  })
})

describe('resetLayout', () => {
  test('restores the default pane size but leaves zenMode untouched', () => {
    useReposStore.setState({
      zenMode: true,
      workspacePaneSize: 70,
    })

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState().zenMode).toBe(true)
    expect(useReposStore.getState().workspacePaneSize).toBe(DEFAULT_WORKSPACE_PANE_SIZE)
  })

  test('is idempotent when pane sizes are already at defaults', () => {
    const before = useReposStore.getState()

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState()).toBe(before)
  })
})
