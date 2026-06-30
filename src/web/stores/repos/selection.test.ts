import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import {
  WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  workspacePaneStaticTabEntry,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/test-utils/bridge.ts'
import {
  workspacePaneStaticTabsForBranch,
  workspacePaneTabsForBranch,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
const REPO_ID = '/tmp/gbl-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
  workspacePaneTabs?: WorkspacePaneTabEntry[]
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
    preferredWorkspacePaneTab: options.preferredWorkspacePaneTab ?? 'status',
    workspacePaneTabsByBranch:
      selectedBranch && (options.workspacePaneTabs ?? options.workspacePaneStaticTabs)
        ? {
            [selectedBranch]:
              options.workspacePaneTabs ?? staticTabs(...(options.workspacePaneStaticTabs ?? [])),
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

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticTabsForBranch(repo.ui, branchName) : []
}

function tabsFor(branchName: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneTabsForBranch(repo.ui, branchName) : []
}

function preferredTabFor(branchName?: string | null): WorkspacePaneTabType | null {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? preferredWorkspacePaneTabForBranch(repo.ui, branchName ?? repo.ui.selectedBranch) : null
}

function restoreWorkspacePaneState(restoreState: Partial<SessionWorkspacePaneRestoreState>) {
  const normalizedRestoreState: SessionWorkspacePaneRestoreState = {
    workspacePaneTabsByBranchByRepo: restoreState.workspacePaneTabsByBranchByRepo ?? {},
    preferredWorkspacePaneTabByBranchByRepo: restoreState.preferredWorkspacePaneTabByBranchByRepo ?? {},
  }
  useReposStore.setState((s) => {
    const repos = restoreSessionWorkspacePaneStateInRepos(s.repos, normalizedRestoreState)
    return repos === s.repos ? s : { repos }
  })
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function staticTabs(...views: WorkspacePaneStaticTabType[]): WorkspacePaneTabEntry[] {
  return views.map((view) => workspacePaneStaticTabEntry(view))
}

function terminalEntry(id: string): WorkspacePaneTabEntry {
  return workspacePaneTerminalTabEntry(id)
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
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.ui).toMatchObject({
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
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('passes the current repo token to follow-up refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })
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

  test('keeps the hidden repo workspace pane selection on that branch', () => {
    seedRepo({
      selectedBranch: 'feature/plain',
      preferredWorkspacePaneTab: 'terminal',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(preferredTabFor('feature/plain')).toBe('terminal')
    expect(preferredTabFor('main')).toBe('status')
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

    expect(useReposStore.getState().repos[REPO_ID]?.dataLoads.pullRequests.phase).toBe('loading')
    resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.ui.selectedBranch).toBe('main')
  })

  test('passes the current repo token to selected branch refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })
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
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneTab: 'terminal' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(preferredTabFor('feature/worktree')).toBe('terminal')
    expect(preferredTabFor('feature/plain')).toBe('status')
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
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.ui.selectedBranch).toBeNull()
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
  test('persists the selected workspace pane tab immediately', () => {
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredTabFor('feature/worktree')).toBe('terminal')
  })

  test('does not refresh when reselecting the current workspace pane tab', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status' })
    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('does not reopen a closed branch-level tab when only selecting its view', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status' })
    useReposStore.getState().closeWorkspacePaneStaticTab(REPO_ID, 'status')

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')

    expect(openTabsFor('main')).toEqual([])
  })

  test('restores a non-worktree workspace pane tab list during session restore', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({
      workspacePaneTabsByBranchByRepo: { [REPO_ID]: { 'feature/plain': staticTabs('history') } },
    })

    expect(preferredTabFor('feature/plain')).toBe('status')
    expect(openTabsFor('feature/plain')).toEqual(['history'])
  })

  test('restores an explicitly empty non-worktree workspace pane tab list during session restore', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({ workspacePaneTabsByBranchByRepo: { [REPO_ID]: { 'feature/plain': [] } } })

    expect(openTabsFor('feature/plain')).toEqual([])
  })

  test('restores a session-preferred files tab when its static tab is open', () => {
    seedRepo({
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'files',
      workspacePaneStaticTabs: ['status', 'files'],
    })

    expect(preferredTabFor('main')).toBe('files')
    expect(openTabsFor('main')).toEqual(['status', 'files'])
  })

  test('does not locally restore a worktree-backed workspace pane tab list during session restore', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({
      workspacePaneTabsByBranchByRepo: {
        [REPO_ID]: { main: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')] },
      },
    })

    expect(openTabsFor('main')).toEqual(['status'])
    expect(tabsFor('main')).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not restore files as preferred when the files tab is closed', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({ preferredWorkspacePaneTabByBranchByRepo: { [REPO_ID]: { main: 'files' } } })

    expect(preferredTabFor('main')).toBe('status')
    expect(openTabsFor('main')).toEqual(['status'])
  })

  test('files is a worktree-scoped static tab and lives in the worktree-only bucket', () => {
    expect(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES).toContain('files')
  })

  test('preserves restored workspace pane tab list before branch snapshot is loaded', () => {
    seedRepo({ selectedBranch: null, branches: [] })

    restoreWorkspacePaneState({ workspacePaneTabsByBranchByRepo: { [REPO_ID]: { main: [] } } })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.workspacePaneTabsByBranch).toEqual({ main: [] })
  })

  test('does not restore a branch-level preferred tab whose tab is closed', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({ preferredWorkspacePaneTabByBranchByRepo: { [REPO_ID]: { main: 'history' } } })

    expect(preferredTabFor('main')).toBe('status')
    expect(openTabsFor('main')).toEqual(['status'])
  })

  test('opens and closes static workspace pane tabs independently of branch selection', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().closeWorkspacePaneStaticTab(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(openTabsFor('main')).toEqual([])

    useReposStore.getState().openWorkspacePaneStaticTab(REPO_ID, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
    expect(openTabsFor('main')).toEqual(['status'])
  })

  test('replaces the unified workspace pane tab list with the canonical entry list', () => {
    seedRepo({
      selectedBranch: 'main',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabs: [
        workspacePaneStaticTabEntry('status'),
        terminalEntry('session-1'),
        workspacePaneStaticTabEntry('history'),
      ],
    })

    useReposStore
      .getState()
      .replaceWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabEntry('history'),
        terminalEntry('session-1'),
        workspacePaneStaticTabEntry('status'),
      ])

    expect(openTabsFor('main')).toEqual(['history', 'status'])
    expect(tabsFor('main')).toEqual([
      workspacePaneStaticTabEntry('history'),
      terminalEntry('session-1'),
      workspacePaneStaticTabEntry('status'),
    ])

    useReposStore.getState().replaceWorkspacePaneTabs(REPO_ID, [workspacePaneStaticTabEntry('history')])
    expect(tabsFor('main')).toEqual([workspacePaneStaticTabEntry('history')])

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore
      .getState()
      .replaceWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('history'),
    ])
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('ensures an existing terminal tab without moving it', () => {
    seedRepo({
      selectedBranch: 'main',
      workspacePaneTabs: [terminalEntry('session-1'), workspacePaneStaticTabEntry('status')],
    })

    useReposStore.getState().ensureWorkspacePaneTerminalTab(REPO_ID, 'session-1')

    expect(tabsFor('main')).toEqual([terminalEntry('session-1'), workspacePaneStaticTabEntry('status')])
  })

  test('ensureAndFocus adds the tab, switches to terminal view, and selects the new terminal', () => {
    seedRepo({ selectedBranch: 'feature/worktree', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().ensureAndFocusWorkspacePaneTerminalTab(REPO_ID, 'session-1')

    expect(tabsFor('feature/worktree')).toEqual([
      workspacePaneStaticTabEntry('status'),
      terminalEntry('session-1'),
    ])
    expect(preferredTabFor('feature/worktree')).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[`${REPO_ID}\0/tmp/feature-worktree`]).toBe(
      'session-1',
    )
  })

  test('ensureAndFocus is a no-op when everything is already focused', () => {
    seedRepo({
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabs: [terminalEntry('session-1')],
    })
    useReposStore.setState({
      selectedTerminalSessionIdByTerminalWorktree: { [`${REPO_ID}\0/tmp/feature-worktree`]: 'session-1' },
    })

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().ensureAndFocusWorkspacePaneTerminalTab(REPO_ID, 'session-1')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('ensureAndFocus does nothing for a branch without a worktree', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })

    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().ensureAndFocusWorkspacePaneTerminalTab(REPO_ID, 'session-1')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
    expect(preferredTabFor('feature/plain')).toBe('status')
  })

  test('replaces hidden worktree-scoped static tabs from the canonical list', () => {
    const hiddenWorktreeEntries = WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES.map(workspacePaneStaticTabEntry)
    seedRepo({
      selectedBranch: 'feature/plain',
      workspacePaneTabs: [
        workspacePaneStaticTabEntry('status'),
        ...hiddenWorktreeEntries,
        workspacePaneStaticTabEntry('history'),
      ],
    })

    useReposStore
      .getState()
      .replaceWorkspacePaneTabs(REPO_ID, [
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('status'),
      ])

    expect(tabsFor('feature/plain')).toEqual([workspacePaneStaticTabEntry('history'), workspacePaneStaticTabEntry('status')])
  })

  test('keeps static workspace pane tabs isolated by branch', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().openWorkspacePaneStaticTab(REPO_ID, 'history')

    expect(openTabsFor('feature/plain')).toEqual(['status', 'history'])
    expect(openTabsFor('main')).toEqual(['status'])

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(openTabsFor('main')).toEqual(['status'])
    expect(openTabsFor('feature/plain')).toEqual(['status', 'history'])
  })

  test('keeps selected workspace pane tabs isolated by branch', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'history')
    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(preferredTabFor('feature/plain')).toBe('history')
    expect(preferredTabFor('main')).toBe('status')

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')
    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    expect(preferredTabFor('main')).toBe('changes')
    expect(preferredTabFor('feature/plain')).toBe('history')
  })

  test('keeps an explicitly closed status tab closed on its branch', () => {
    seedRepo({ selectedBranch: 'main' })

    useReposStore.getState().closeWorkspacePaneStaticTab(REPO_ID, 'status')
    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')
    useReposStore.getState().openWorkspacePaneStaticTab(REPO_ID, 'status')

    expect(openTabsFor('feature/plain')).toEqual(['status'])
    expect(openTabsFor('main')).toEqual([])
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(preferredTabFor('main')).toBe('changes')
  })

  test('passes the current repo token to workspace pane tab refreshes', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'terminal' })
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
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'terminal' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')
    await flushAsyncWork()

    expect(calls).toEqual([['main']])
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setWorkspacePaneTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane tabs.
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'terminal' })
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
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
