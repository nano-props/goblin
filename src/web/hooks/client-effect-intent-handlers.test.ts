// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handleWorkspaceClientIntent } from '#/web/hooks/client-effect-intent-handlers.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/gbl-client-intent-handlers-repo'

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  resetReposStore()
})

describe('client effect intent handlers', () => {
  test('returns false when changes cannot be shown for a branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'status',
    })

    await expect(
      handleWorkspaceClientIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' }, deps(REPO_ID)),
    ).resolves.toBe(false)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo ? preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) : null).toBe('status')
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
    isOverlayOpen: () => false,
    isWorkspaceShortcutSuppressed: () => false,
    ensureWorkspaceOpen: vi.fn(async (input: string | { id: string }) => ({
      ok: true as const,
      id: typeof input === 'string' ? input : input.id,
    })),
    setSelectedTerminal: vi.fn(),
    resetLayout: vi.fn(),
    toggleWorkspaceFocused: vi.fn(),
    t: (key: string) => key,
  }
}

function navigationWithStoreActions(): MainWindowNavigationActions {
  return {
    activateRepo: (repoId) => useReposStore.getState().setActive(repoId),
    closeRepo: (repoId) => useReposStore.getState().closeRepo(repoId),
    cycleRepo: (direction) => useReposStore.getState().cycleActive(direction),
    selectRepoBranch: (repoId, branch) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
    },
    showRepoWorkspacePaneView: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneView(repoId, tab)
    },
    showRepoBranchWorkspacePaneView: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneView(repoId, tab)
    },
    openSettings: vi.fn(),
  }
}
