import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/web/stores/repos/store.ts'
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
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
const REPO_ID = 'goblin+file:///tmp/goblin-selection-test-repo'
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  currentBranchName?: string | null
  currentBranch?: string
  preferredWorkspacePaneTab?: WorkspacePaneTabType | null
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
  branches?: BranchSnapshotInfo[]
}) {
  const currentBranchName = options.currentBranchName === undefined ? 'feature/plain' : options.currentBranchName
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: options.branches ?? [
      branch('main', { worktree: { path: '/repo' } }),
      branch('feature/worktree', { worktree: { path: '/tmp/feature-worktree' } }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    currentBranchName,
    preferredWorkspacePaneTab:
      options.preferredWorkspacePaneTab === undefined ? 'status' : options.preferredWorkspacePaneTab,
    workspacePaneTabsByBranch:
      currentBranchName && options.workspacePaneStaticTabs
        ? {
            [currentBranchName]: staticTabs(...options.workspacePaneStaticTabs),
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
  const repo = emptyRepo(REPO_ID, 'selection-test-repo', 'repo-runtime-selection-no-query')
  useReposStore.setState((s) => ({
    repos: { ...s.repos, [REPO_ID]: repo },
    order: [...s.order, REPO_ID],
    restoredRepoId: REPO_ID,
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
    target ? readWorkspacePaneTabsForTarget({ ...target, repoRuntimeId: repo.repoRuntimeId }) : [],
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
              branchName ?? 'main',
            )
          : null,
      )
    : null
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function staticTabs(...views: WorkspacePaneStaticTabType[]): WorkspacePaneTabEntry[] {
  return views.map((view) => workspacePaneStaticTabEntry(view))
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(ipcHandlers)
})

describe('setBranchViewMode', () => {
  test('persists branch view mode without retargeting branch selection', () => {
    seedRepo({ currentBranchName: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(useReposStore.getState().repoSnapshotCache[REPO_ID]?.ui).toMatchObject({
      branchViewMode: 'worktrees',
    })
  })

  test('keeps the selected branch when it remains visible', () => {
    seedRepo({ currentBranch: 'feature/worktree', currentBranchName: 'feature/worktree' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(readRepoBranchQueryProjection(repo!)?.currentBranch).toBe('feature/worktree')
  })

  test('keeps the selected branch when the new view mode has no visible branches', () => {
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(readRepoBranchQueryProjection(repo!)?.currentBranch).toBe('main')
  })

  test('changes branch view mode without mutating the React Query projection read model', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/plain',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
      currentBranch: 'main',
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const updatedRepo = useReposStore.getState().repos[REPO_ID]
    expect(updatedRepo?.ui.branchViewMode).toBe('worktrees')
    expect(readRepoBranchQueryProjection(updatedRepo!)?.currentBranch).toBe('main')
    expect(readRepoBranchQueryProjection(updatedRepo!)?.branches.map((repoBranch) => repoBranch.name)).toEqual([
      'main',
      'feature/plain',
    ])
  })

  test('keeps the hidden repo workspace pane selection on that branch', () => {
    seedRepo({
      currentBranchName: 'feature/plain',
      preferredWorkspacePaneTab: 'terminal',
      branches: [branch('main', { worktree: { path: '/repo' } }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
    expect(preferredTabFor('main')).toBe('status')
  })
})

describe('setWorkspacePaneTab', () => {
  test('fails when the repo branch snapshot is unavailable', () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'changes')).toThrow(
      'repo branch snapshot query data unavailable for repo',
    )
  })

  test('persists the selected workspace pane tab immediately', () => {
    seedRepo({ currentBranchName: 'feature/worktree', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')

    expect(preferredTabFor('feature/worktree')).toBe('terminal')
  })

  test('does not refresh when reselecting the current workspace pane tab', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })
    const before = useReposStore.getState().repos[REPO_ID]
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')
    expect(useReposStore.getState().repos[REPO_ID]).toBe(before)
  })

  test('uses the React Query projection read model to resolve workspace pane tab targets', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [branch('feature/query', { worktree: { path: '/tmp/query-worktree' } })],
      currentBranch: 'feature/query',
    })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/query', 'changes')

    expect(
      useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[
        worktreeTargetKey('feature/query', '/tmp/query-worktree')
      ],
    ).toBe('changes')
  })

  test('restores a session-preferred files tab when its static tab is open', () => {
    seedRepo({
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'files',
      workspacePaneStaticTabs: ['status', 'files'],
    })

    expect(preferredTabFor('main')).toBe('files')
    expect(openTabsFor('main')).toEqual(['status', 'files'])
  })

  test('files is a worktree-scoped static tab and lives in the worktree-only bucket', () => {
    expect(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES).toContain('files')
  })

  test('keeps selected workspace pane tabs isolated by branch', () => {
    seedRepo({ currentBranchName: 'feature/plain' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'history')

    expect(preferredTabFor('feature/plain')).toBe('history')
    expect(preferredTabFor('main')).toBe('status')

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')

    expect(preferredTabFor('main')).toBe('changes')
    expect(preferredTabFor('feature/plain')).toBe('history')
  })

  test('persists an intentional empty workspace pane preference', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'main', null)

    expect(preferredTabFor('main')).toBeNull()
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')
    await flushAsyncWork()

    expect(preferredTabFor('main')).toBe('changes')
  })

  test('keeps workspace pane tab selection as a UI preference write', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'terminal' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')

    expect(preferredTabFor('main')).toBe('status')
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setWorkspacePaneTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane tabs.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'status' })

    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'terminal' })
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

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
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })
    useReposStore.getState().setZenMode(true)

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

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
