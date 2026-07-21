// @vitest-environment jsdom
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import {
  handleTerminalBellClickIntent,
  handleWorkspaceClientIntent,
} from '#/web/hooks/client-effect-intent-handlers.ts'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { observedWorkspacePaneRouteCommitForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey } from '#/web/repo-query-keys.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-client-intent-handlers-repo')

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  resetWorkspacesStore()
})

describe('client effect intent handlers', () => {
  test('routes terminal bell clicks through the React Query projection read model', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/bell-worktree' } })],
      currentBranch: 'feature/query',
    })
    const d = deps(REPO_ID)
    d.navigation.showRepoBranchTerminalSession = vi.fn(() => true)
    handleTerminalBellClickIntent(
      {
        type: 'terminal-bell-click',
        terminalSessionId: 'term-queryqueryqueryquery1',
        session: {
          target: {
            kind: 'git-worktree',
            workspaceId: REPO_ID,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            root: workspaceIdForTest('goblin+file:///tmp/bell-worktree'),
          },
          presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/query' } },
        },
      },
      d,
    )

    await vi.waitFor(() => {
      expect(d.navigation.showRepoBranchTerminalSession).toHaveBeenCalledWith(
        REPO_ID,
        'feature/query',
        'term-queryqueryqueryquery1',
      )
    })
  })

  test('returns false when changes cannot be shown for a branch without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })

    await expect(
      handleWorkspaceClientIntent(
        { type: 'show-workspace-pane-tab-requested', tab: 'changes' },
        deps(REPO_ID, 'feature/no-worktree'),
      ),
    ).resolves.toBe(false)
  })

  test('create-worktree-requested opens create-worktree for the current repo', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [createRepoBranch('main')] })
    const d = deps(REPO_ID)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('create-worktree-requested is a no-op when no repo is active', async () => {
    const d = deps(null)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('create-worktree-requested shows a busy toast while a branch action is running', async () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [createRepoBranch('main')] })
    useWorkspacesStore.setState((state) => {
      const repo = state.workspaces[REPO_ID]
      if (repo?.capability.kind !== 'git') return state
      const branchAction = {
        ...repo.capability.git.operations.branchAction,
        phase: 'running' as const,
        reason: 'branch:pull' as const,
        target: 'main',
      }
      const operations = { ...repo.capability.git.operations, branchAction }
      return {
        workspaces: {
          ...state.workspaces,
          [REPO_ID]: {
            ...repo,
            capability: { ...repo.capability, git: { ...repo.capability.git, operations } },
          },
        },
      }
    })
    const d = deps(REPO_ID)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('create-worktree-requested reads busy state from server operations projection', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [createRepoBranch('main')] })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const d = deps(REPO_ID)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })

  test('create-worktree-requested does not project retained operations after a canonical read error', async () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [createRepoBranch('main')] })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })
    const queryKey = repoOperationsQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = primaryWindowQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('error.repository-boundary-unavailable') })
    const d = deps(REPO_ID)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).toHaveBeenCalledOnce()
    expect(toast.error).not.toHaveBeenCalled()
  })
})

function deps(currentWorkspaceId: string | null, currentBranchName = 'feature/worktree') {
  return {
    navigation: navigationWithStoreActions(),
    currentWorkspaceId,
    currentWorkspacePaneCommandTarget: currentWorkspaceId
      ? { kind: 'git-branch' as const, branchName: currentBranchName, workspacePaneRoute: null }
      : null,
    closeAllOverlays: vi.fn(),
    openWorkspacePathDialog: vi.fn(),
    openCloneRepo: vi.fn(),
    openRemoteWorkspace: vi.fn(),
    openCreateWorktree: vi.fn(),
    isOverlayOpen: () => false,
    isWorkspaceShortcutSuppressed: () => false,
    ensureWorkspaceOpen: vi.fn(async (input: string | { id: string }) => ({
      ok: true as const,
      workspaceId: workspaceIdForTest(typeof input === 'string' ? input : input.id),
    })),
    resetLayout: vi.fn(),
    toggleZenMode: vi.fn(),
    t: (key: string) => key,
  }
}

function navigationWithStoreActions(): PrimaryWindowNavigationActions {
  const navigation: PrimaryWindowNavigationActions = {
    currentWorkspacePaneRoute: () => undefined,
    activateWorkspace: vi.fn(),
    closeWorkspace: (workspaceId) => useWorkspacesStore.getState().closeWorkspace(workspaceId),
    cycleWorkspace: vi.fn(),
    selectRepoBranch: vi.fn(),
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useWorkspacesStore.getState()
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    },
    showRepoBranchTerminalSession: vi.fn(() => true),
    commitWorkspacePaneRoute: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
  }
  navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  return navigation
}

function serverOperation(
  workspaceRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId,
    kind: overrides.kind,
    phase: overrides.phase,
    source: 'user',
    target: null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}
