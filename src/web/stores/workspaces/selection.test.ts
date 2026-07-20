import { beforeEach, describe, expect, test } from 'vitest'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  createRepoBranch as branch,
  installGoblinTestBridge,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import type { BranchSnapshotInfo } from '#/web/types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-selection-test-repo')
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
  const repo = emptyWorkspace(REPO_ID, 'selection-test-repo', 'repo-runtime-selection-no-query')
  useWorkspacesStore.setState((s) => ({
    workspaces: { ...s.workspaces, [REPO_ID]: repo },
    workspaceOrder: [...s.workspaceOrder, REPO_ID],
    restoredWorkspaceId: REPO_ID,
  }))
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
  const target =
    repo && branchModel
      ? workspacePaneTabsTargetForRepoBranch({ workspaceId: repo.id, branches: branchModel.branches }, branchName)
      : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : [],
  )
}

function preferredTabFor(branchName?: string | null): WorkspacePaneTabType | null {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        branchModel
          ? workspacePaneTabsTargetForRepoBranch(
              { workspaceId: repo.id, branches: branchModel.branches },
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
  resetWorkspacesStore()
  installGoblinTestBridge(ipcHandlers)
})

describe('setBranchViewMode', () => {
  test('persists branch view mode without retargeting branch selection', () => {
    seedRepo({ currentBranchName: 'feature/plain' })

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
    expect(useWorkspacesStore.getState().repoSnapshotCache[REPO_ID]?.ui).toMatchObject({
      branchViewMode: 'worktrees',
    })
  })

  test('keeps the selected branch when it remains visible', () => {
    seedRepo({ currentBranch: 'feature/worktree', currentBranchName: 'feature/worktree' })

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
    expect(readRepoBranchQueryProjection(repo!)?.currentBranch).toBe('feature/worktree')
  })

  test('keeps the selected branch when the new view mode has no visible branches', () => {
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(repo).capability.git.ui.branchViewMode).toBe('worktrees')
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

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const updatedRepo = useWorkspacesStore.getState().workspaces[REPO_ID]
    expect(requireGitWorkspaceForTest(updatedRepo).capability.git.ui.branchViewMode).toBe('worktrees')
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

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
    expect(preferredTabFor('main')).toBe('status')
  })
})

describe('setWorkspacePaneTab', () => {
  test('fails when the repo branch snapshot is unavailable', () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'changes')).toThrow(
      'repo branch snapshot query data unavailable for repo',
    )
  })

  test('persists the selected workspace pane tab immediately', () => {
    seedRepo({ currentBranchName: 'feature/worktree', preferredWorkspacePaneTab: 'status' })

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')

    expect(preferredTabFor('feature/worktree')).toBe('terminal')
  })

  test('does not refresh when reselecting the current workspace pane tab', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })
    const before = useWorkspacesStore.getState().workspaces[REPO_ID]
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')
    expect(useWorkspacesStore.getState().workspaces[REPO_ID]).toBe(before)
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

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/query', 'changes')

    expect(
      useWorkspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[
        worktreeTargetKey('/tmp/query-worktree')
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

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'history')

    expect(preferredTabFor('feature/plain')).toBe('history')
    expect(preferredTabFor('main')).toBe('status')

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')

    expect(preferredTabFor('main')).toBe('changes')
    expect(preferredTabFor('feature/plain')).toBe('history')
  })

  test('persists an intentional empty workspace pane preference', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', null)

    expect(preferredTabFor('main')).toBeNull()
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')
    await flushAsyncWork()

    expect(preferredTabFor('main')).toBe('changes')
  })

  test('keeps workspace pane tab selection as a UI preference write', () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'terminal' })

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')

    expect(preferredTabFor('main')).toBe('status')
  })

  test('sets the terminal preference regardless of worktree presence', () => {
    // setWorkspacePaneTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane tabs.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'status' })

    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'terminal' })
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })
})

function worktreeTargetKey(worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ kind: 'git-worktree', workspaceId: REPO_ID, worktreePath })
}

describe('workspace pane layout state', () => {
  test('applies session pane state atomically with shared normalization rules', () => {
    useWorkspacesStore.getState().applySessionLayoutState({
      zenMode: true,
      workspacePaneSize: 45,
    })

    expect(useWorkspacesStore.getState()).toMatchObject({
      zenMode: true,
      workspacePaneSize: 45,
    })
  })
})

describe('setZenMode', () => {
  test('enables large-screen Zen Mode', () => {
    useWorkspacesStore.getState().setZenMode(true)

    expect(useWorkspacesStore.getState().zenMode).toBe(true)
  })

  test('can disable large-screen Zen Mode again', () => {
    useWorkspacesStore.getState().setZenMode(true)
    useWorkspacesStore.getState().setZenMode(false)

    expect(useWorkspacesStore.getState().zenMode).toBe(false)
  })

  test('toggles large-screen Zen Mode', () => {
    useWorkspacesStore.getState().toggleZenMode()

    expect(useWorkspacesStore.getState().zenMode).toBe(true)
  })

  test('preserves large-screen Zen Mode when filtering leaves no selected branch', () => {
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })
    useWorkspacesStore.getState().setZenMode(true)

    useWorkspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useWorkspacesStore.getState().zenMode).toBe(true)
  })
})

describe('setWorkspacePaneSize', () => {
  test('stores the workspace pane size', () => {
    useWorkspacesStore.getState().setWorkspacePaneSize(72.28)

    expect(useWorkspacesStore.getState().workspacePaneSize).toBe(72.3)
  })

  test('normalizes invalid and out-of-range sizes', () => {
    useWorkspacesStore.getState().setWorkspacePaneSize(200)

    expect(useWorkspacesStore.getState().workspacePaneSize).toBe(90)
  })
})

describe('resetLayout', () => {
  test('restores the default pane size but leaves zenMode untouched', () => {
    useWorkspacesStore.setState({
      zenMode: true,
      workspacePaneSize: 70,
    })

    useWorkspacesStore.getState().resetLayout()

    expect(useWorkspacesStore.getState().zenMode).toBe(true)
    expect(useWorkspacesStore.getState().workspacePaneSize).toBe(DEFAULT_WORKSPACE_PANE_SIZE)
  })

  test('is idempotent when pane sizes are already at defaults', () => {
    const before = useWorkspacesStore.getState()

    useWorkspacesStore.getState().resetLayout()

    expect(useWorkspacesStore.getState()).toBe(before)
  })
})
