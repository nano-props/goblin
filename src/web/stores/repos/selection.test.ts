import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/test-utils/bridge.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { restoreSessionWorkspacePaneStateInRepos } from '#/web/stores/repos/workspace-pane-session-restore.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
const REPO_ID = '/tmp/gbl-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
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
      selectedBranch && options.workspacePaneStaticTabs
        ? {
            [selectedBranch]: staticTabs(...options.workspacePaneStaticTabs),
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

function seedRepoShellWithoutBranchReadModel(): void {
  const repo = emptyRepo(REPO_ID, 'selection-test-repo', 'repo-instance-selection-no-query')
  repo.ui.selectedBranch = 'main'
  useReposStore.setState((s) => ({
    repos: { ...s.repos, [REPO_ID]: repo },
    order: [...s.order, REPO_ID],
    activeId: REPO_ID,
  }))
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
  const target =
    repo && branchModel
      ? workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: branchModel.branches }, branchName)
      : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, repoInstanceId: repo.instanceId }) : [],
  )
}

function preferredTabFor(branchName?: string | null): WorkspacePaneTabType | null {
  const repo = useReposStore.getState().repos[REPO_ID]
  const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        branchModel
          ? workspacePaneTabsTargetForRepoBranch(
              { repoRoot: repo.id, branches: branchModel.branches },
              branchName ?? repo.ui.selectedBranch,
            )
          : null,
      )
    : null
}

function restoreWorkspacePaneState(restoreState: Partial<SessionWorkspacePaneRestoreState>) {
  const normalizedRestoreState: SessionWorkspacePaneRestoreState = {
    workspacePaneTabsByTargetByRepo: restoreState.workspacePaneTabsByTargetByRepo ?? {},
    preferredWorkspacePaneTabByTargetByRepo: restoreState.preferredWorkspacePaneTabByTargetByRepo ?? {},
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
  primaryWindowQueryClient.clear()
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(ipcHandlers)
  ipcHandlers['repo.pullRequests'] = async () => []
  ipcHandlers['repo.status'] = async () => []
})

describe('setBranchViewMode', () => {
  test('fails when the repo branch read model is unavailable', () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')).toThrow(
      'repo branch read model query data unavailable for repo',
    )
  })

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

  test('uses the React Query snapshot read model when changing branch view mode', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/plain',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'main',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('main')
  })

  test('passes the current repo instance id to follow-up refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { repoInstanceId, mode: 'full' }])
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
  test('fails when the repo branch read model is unavailable', () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => useReposStore.getState().selectBranch(REPO_ID, 'feature/query')).toThrow(
      'repo branch read model query data unavailable for repo',
    )
  })

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

  test('passes the current repo instance id to selected branch refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', preferredWorkspacePaneTab: 'status' })
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().selectBranch(REPO_ID, 'main')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { repoInstanceId, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('uses the React Query snapshot read model to validate selected branches', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'main',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'main',
      branches: [branch('main'), branch('feature/query')],
    })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/query')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/query')
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
  test('fails when the repo branch read model is unavailable', () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')).toThrow(
      'repo branch read model query data unavailable for repo',
    )
  })

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

  test('uses the React Query snapshot read model to resolve workspace pane tab targets', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [branch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
    })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')

    expect(
      useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[
        worktreeTargetKey('feature/query', '/tmp/query-worktree')
      ],
    ).toBe('changes')
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

  test('does not restore files as preferred when the files tab is closed', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({
      preferredWorkspacePaneTabByTargetByRepo: { [REPO_ID]: { [worktreeTargetKey('main', '/repo')]: 'files' } },
    })

    expect(preferredTabFor('main')).toBe('status')
    expect(openTabsFor('main')).toEqual(['status'])
  })

  test('files is a worktree-scoped static tab and lives in the worktree-only bucket', () => {
    expect(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES).toContain('files')
  })

  test('does not restore a target-level preferred tab whose tab is closed', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status', workspacePaneStaticTabs: ['status'] })

    restoreWorkspacePaneState({
      preferredWorkspacePaneTabByTargetByRepo: { [REPO_ID]: { [worktreeTargetKey('main', '/repo')]: 'history' } },
    })

    expect(preferredTabFor('main')).toBe('status')
    expect(openTabsFor('main')).toEqual(['status'])
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

  test('persists the changes tab immediately', async () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(preferredTabFor('main')).toBe('changes')
  })

  test('passes the current repo instance id to workspace pane tab refreshes', () => {
    seedRepo({ selectedBranch: 'main', preferredWorkspacePaneTab: 'terminal' })
    const repoInstanceId = useReposStore.getState().repos[REPO_ID]!.instanceId
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { repoInstanceId, mode: 'full' }])
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

function worktreeTargetKey(branchName: string, worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ repoRoot: REPO_ID, branchName, worktreePath })
}

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
