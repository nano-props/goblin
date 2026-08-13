import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch as branch,
  createRepoWorktreeSnapshotForTest,
  repoPresentationFromQueryForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-client-state.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-selection-test-repo')
const ipcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  currentBranchName?: string | null
  currentBranch?: string
  preferredWorkspacePaneTab?: WorkspacePaneTabType | null
  workspacePaneStaticTabs?: WorkspacePaneStaticTabType[]
  branches?: BranchSnapshotInfo[]
  worktrees?: ReturnType<typeof createRepoWorktreeSnapshotForTest>[]
}) {
  const currentBranchName = options.currentBranchName === undefined ? 'feature/plain' : options.currentBranchName
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: options.branches ?? [branch('main'), branch('feature/worktree'), branch('feature/plain')],
    worktrees: options.worktrees ?? [
      createRepoWorktreeSnapshotForTest('main', '/repo'),
      createRepoWorktreeSnapshotForTest('feature/worktree', '/tmp/feature-worktree'),
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
      remotes: [
        { name: 'origin', fetchUrl: 'https://example.test/repo.git', pushUrl: 'https://example.test/repo.git' },
      ],
      hasRemotes: true,
      hasBrowserRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
      hasGitHubRemote: true,
    },
  })
}

function seedRepoShellWithoutBranchReadModel(): void {
  const repo = emptyWorkspace(REPO_ID, 'repo-runtime-selection-no-query')
  workspacesStore.setState((s) => ({
    workspaces: { ...s.workspaces, [REPO_ID]: repo },
    workspaceOrder: [...s.workspaceOrder, REPO_ID],
    restoredWorkspaceId: REPO_ID,
  }))
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  const branchModel = repo ? repoPresentationFromQueryForTest(repo).snapshot : null
  const target =
    repo && branchModel
      ? workspacePaneTabsTargetForRepoBranch(
          { workspaceId: repo.id, branches: branchModel.branches, worktrees: branchModel.worktrees },
          branchName,
        )
      : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : [],
  )
}

function preferredTabFor(branchName?: string | null): WorkspacePaneTabType | null {
  const repo = workspacesStore.getState().workspaces[REPO_ID]
  const branchModel = repo ? repoPresentationFromQueryForTest(repo).snapshot : null
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        branchModel
          ? workspacePaneTabsTargetForRepoBranch(
              { workspaceId: repo.id, branches: branchModel.branches, worktrees: branchModel.worktrees },
              branchName ?? 'main',
            )
          : null,
      )
    : null
}

async function flushAsyncWork() {
  await waitForNextMacrotask()
}

function staticTabs(...views: WorkspacePaneStaticTabType[]): WorkspacePaneTabEntry[] {
  return views.map((view) => workspacePaneStaticTabEntry(view))
}

beforeEach(() => {
  appQueryClient.clear()
  for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key]
  resetWorkspacesStore()
  installGoblinTestBridge(ipcHandlers)
})

describe('setBranchViewMode', () => {
  test('resetWorkspacesStore clears the persisted view mode map', async () => {
    seedRepo({ currentBranchName: 'feature/plain' })
    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    resetWorkspacesStore()

    expect(workspacesStore.getState().branchViewModeByWorkspace).toEqual({})
  })

  test('sets branch view mode for the workspace', async () => {
    seedRepo({ currentBranchName: 'feature/plain' })

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
  })

  test('keeps the selected branch when it remains visible', async () => {
    seedRepo({ currentBranch: 'feature/worktree', currentBranchName: 'feature/worktree' })

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = workspacesStore.getState().workspaces[REPO_ID]
    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
    expect(repoPresentationFromQueryForTest(repo!).snapshot.current).toBe('feature/worktree')
  })

  test('keeps the selected branch when the new view mode has no visible branches', async () => {
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = workspacesStore.getState().workspaces[REPO_ID]
    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
    expect(repoPresentationFromQueryForTest(repo!).snapshot.current).toBe('main')
  })

  test('changes branch view mode without mutating the TanStack Query snapshot', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/plain',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [branch('main'), branch('feature/plain')],
      currentBranch: 'main',
      worktrees: [createRepoWorktreeSnapshotForTest('main', '/repo')],
    })

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const updatedRepo = workspacesStore.getState().workspaces[REPO_ID]
    expect(workspacesStore.getState().branchViewModeByWorkspace?.[REPO_ID]).toBe('worktrees')
    expect(repoPresentationFromQueryForTest(updatedRepo!).snapshot.current).toBe('main')
    expect(
      repoPresentationFromQueryForTest(updatedRepo!).snapshot.branches.map((repoBranch) => repoBranch.name),
    ).toEqual(['main', 'feature/plain'])
  })

  test('keeps the hidden repo workspace pane selection on that branch', async () => {
    seedRepo({
      currentBranchName: 'feature/plain',
      preferredWorkspacePaneTab: 'terminal',
      branches: [branch('main'), branch('feature/plain')],
      worktrees: [createRepoWorktreeSnapshotForTest('main', '/repo')],
    })

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
    expect(preferredTabFor('main')).toBe('status')
  })
})

describe('setWorkspacePaneTab', () => {
  test('fails when the repo branch snapshot is unavailable', async () => {
    seedRepoShellWithoutBranchReadModel()

    expect(() => workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'changes')).toThrow(
      'repository snapshot query data unavailable for workspace',
    )
  })

  test('persists the selected workspace pane tab immediately', async () => {
    seedRepo({ currentBranchName: 'feature/worktree', preferredWorkspacePaneTab: 'status' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')

    expect(preferredTabFor('feature/worktree')).toBe('terminal')
  })

  test('does not refresh when reselecting the current workspace pane tab', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })
    const before = workspacesStore.getState().workspaces[REPO_ID]
    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')
    expect(workspacesStore.getState().workspaces[REPO_ID]).toBe(before)
  })

  test('uses the TanStack Query snapshot to resolve workspace pane tab targets', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [branch('feature/query')],
      currentBranch: 'feature/query',
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query', '/tmp/query-worktree')],
    })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/query', 'changes')

    expect(
      workspacesStore.getState().workspaces[REPO_ID]?.ui.preferredWorkspacePaneTabByTarget[
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

  test('keeps selected workspace pane tabs isolated by branch', async () => {
    seedRepo({ currentBranchName: 'feature/plain' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'history')

    expect(preferredTabFor('feature/plain')).toBe('history')
    expect(preferredTabFor('main')).toBe('status')

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')

    expect(preferredTabFor('main')).toBe('changes')
    expect(preferredTabFor('feature/plain')).toBe('history')
  })

  test('persists an intentional empty workspace pane preference', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', null)

    expect(preferredTabFor('main')).toBeNull()
  })

  test('persists the changes tab immediately', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'status' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'changes')
    await flushAsyncWork()

    expect(preferredTabFor('main')).toBe('changes')
  })

  test('keeps workspace pane tab selection as a UI preference write', async () => {
    seedRepo({ currentBranchName: 'main', preferredWorkspacePaneTab: 'terminal' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'main', 'status')

    expect(preferredTabFor('main')).toBe('status')
  })

  test('sets the terminal preference regardless of worktree presence', async () => {
    // setWorkspacePaneTab is a pure preference write. Whether `terminal` is
    // *renderable* is decided at read time from the active branch worktree,
    // terminal session count, and opened workspace pane tabs.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'status' })

    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })

  test('preserves the terminal preference even when no worktree exists for the active branch', async () => {
    // Previously the store would re-project to `status` here. With the
    // derived-value pattern the preference is preserved; the UI hook
    // returns `status` for the rendered tab.
    seedRepo({ currentBranchName: 'feature/plain', preferredWorkspacePaneTab: 'terminal' })
    workspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/plain', 'terminal')

    expect(preferredTabFor('feature/plain')).toBe('terminal')
  })
})

function worktreeTargetKey(worktreePath: string): string {
  return workspacePaneTabsTargetIdentityKey({ kind: 'git-worktree', workspaceId: REPO_ID, worktreePath })
}

describe('workspace pane layout state', () => {
  test('applies session pane state atomically with shared normalization rules', async () => {
    workspacesStore.getState().applySessionLayoutState({
      zenMode: true,
      workspacePaneSize: 45,
    })

    expect(workspacesStore.getState()).toMatchObject({
      zenMode: true,
      workspacePaneSize: 45,
    })
  })
})

describe('setZenMode', () => {
  test('enables large-screen Zen Mode', async () => {
    workspacesStore.getState().setZenMode(true)

    expect(workspacesStore.getState().zenMode).toBe(true)
  })

  test('can disable large-screen Zen Mode again', async () => {
    workspacesStore.getState().setZenMode(true)
    workspacesStore.getState().setZenMode(false)

    expect(workspacesStore.getState().zenMode).toBe(false)
  })

  test('toggles large-screen Zen Mode', async () => {
    workspacesStore.getState().toggleZenMode()

    expect(workspacesStore.getState().zenMode).toBe(true)
  })

  test('preserves large-screen Zen Mode when filtering leaves no selected branch', async () => {
    seedRepo({ currentBranchName: 'main', branches: [branch('main')] })
    workspacesStore.getState().setZenMode(true)

    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(workspacesStore.getState().zenMode).toBe(true)
  })
})

describe('setWorkspacePaneSize', () => {
  test('stores the workspace pane size', async () => {
    workspacesStore.getState().setWorkspacePaneSize(72.28)

    expect(workspacesStore.getState().workspacePaneSize).toBe(72.3)
  })

  test('normalizes invalid and out-of-range sizes', async () => {
    workspacesStore.getState().setWorkspacePaneSize(200)

    expect(workspacesStore.getState().workspacePaneSize).toBe(90)
  })
})

describe('resetLayout', () => {
  test('restores the default pane size but leaves zenMode untouched', async () => {
    workspacesStore.setState({
      zenMode: true,
      workspacePaneSize: 70,
    })

    workspacesStore.getState().resetLayout()

    expect(workspacesStore.getState().zenMode).toBe(true)
    expect(workspacesStore.getState().workspacePaneSize).toBe(DEFAULT_WORKSPACE_PANE_SIZE)
  })

  test('is idempotent when pane sizes are already at defaults', async () => {
    const before = workspacesStore.getState()

    workspacesStore.getState().resetLayout()

    expect(workspacesStore.getState()).toBe(before)
  })
})
