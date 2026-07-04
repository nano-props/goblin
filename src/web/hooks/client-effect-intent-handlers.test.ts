// @vitest-environment jsdom

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
import { preferredWorkspacePaneTabForTarget, workspacePaneTabsTargetForRepoBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

const REPO_ID = '/tmp/gbl-client-intent-handlers-repo'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
})

afterEach(() => {
  resetReposStore()
})

describe('client effect intent handlers', () => {
  test('routes terminal bell clicks through the React Query snapshot read model', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/query',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [createRepoBranch('feature/query', { worktree: { path: '/tmp/bell-worktree' } })],
    })
    const d = deps(REPO_ID)
    d.navigation.showRepoBranchWorkspacePaneTab = vi.fn()

    handleTerminalBellClickIntent(
      {
        type: 'terminal-bell-click',
        repoRoot: REPO_ID,
        terminalSessionId: 'session-query',
        terminalWorktreeKey: `${REPO_ID}\0/tmp/bell-worktree`,
      },
      d,
    )

    expect(d.setSelectedTerminal).toHaveBeenCalledWith(`${REPO_ID}\0/tmp/bell-worktree`, 'session-query')
    expect(d.navigation.showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/query', 'terminal')
  })

  test('returns false when changes cannot be shown for a branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })

    await expect(
      handleWorkspaceClientIntent({ type: 'show-workspace-pane-tab-requested', tab: 'changes' }, deps(REPO_ID)),
    ).resolves.toBe(false)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo ? preferredWorkspacePaneTabForTarget(repo.ui, workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] }, repo.ui.selectedBranch)) : null).toBe('status')
  })

  test('create-worktree-requested opens create-worktree for the current repo', async () => {
    seedRepoState({ id: REPO_ID, branches: [createRepoBranch('main')] })
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
    seedRepoState({ id: REPO_ID, branches: [createRepoBranch('main')] })
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      return {
        repos: {
          ...state.repos,
          [REPO_ID]: {
            ...repo,
            operations: {
              ...repo.operations,
              branchAction: {
                ...repo.operations.branchAction,
                phase: 'running',
                reason: 'branch:pull',
                target: 'main',
              },
            },
          },
        },
      }
    })
    const d = deps(REPO_ID)

    await expect(handleWorkspaceClientIntent({ type: 'create-worktree-requested' }, d)).resolves.toBe(true)
    expect(d.openCreateWorktree).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('action.create-worktree-busy')
  })
})

function deps(currentRepoId: string | null) {
  return {
    navigation: navigationWithStoreActions(),
    currentRepoId,
    closeAllOverlays: vi.fn(),
    openRepoPathDialog: vi.fn(),
    openCloneRepo: vi.fn(),
    openRemoteRepo: vi.fn(),
    openCreateWorktree: vi.fn(),
    isOverlayOpen: () => false,
    isWorkspaceShortcutSuppressed: () => false,
    ensureWorkspaceOpen: vi.fn(async (input: string | { id: string }) => ({
      ok: true as const,
      id: typeof input === 'string' ? input : input.id,
    })),
    setSelectedTerminal: vi.fn(),
    resetLayout: vi.fn(),
    toggleZenMode: vi.fn(),
    t: (key: string) => key,
  }
}

function navigationWithStoreActions(): PrimaryWindowNavigationActions {
  return {
    activateRepo: (repoId) => useReposStore.getState().setActive(repoId),
    closeRepo: (repoId) => useReposStore.getState().closeRepo(repoId),
    cycleRepo: (direction) => useReposStore.getState().cycleActive(direction),
    selectRepoBranch: (repoId, branch) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
    },
    showRepoWorkspacePaneTab: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneTab(repoId, tab)
    },
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneTab(repoId, tab)
    },
    openSettings: vi.fn(),
  }
}
