// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handleWorkspaceRendererIntent } from '#/web/hooks/renderer-effect-intent-handlers.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const REPO_ID = '/tmp/gbl-renderer-intent-handlers-repo'
const WORKTREE_PATH = '/tmp/gbl-renderer-intent-handlers-worktree'
const WORKTREE_KEY = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
})

describe('renderer effect intent handlers', () => {
  test('returns false when a workspace pane command fails before committing selection', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'status',
    })
    const openWorkspacePaneView = vi.fn(async () => false)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        staticWorkspacePaneViews: [],
        workspacePaneViews: [],
        sessions: [],
        count: 0,
        bellCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'terminal-1'),
      selectTerminal: vi.fn(),
      openWorkspacePaneView,
      closeWorkspacePaneView: vi.fn(async () => true),
      reorderWorkspacePaneViews: vi.fn(async () => true),
    })

    await expect(
      handleWorkspaceRendererIntent({ type: 'show-workspace-pane-view-requested', tab: 'changes' }, deps(REPO_ID)),
    ).resolves.toBe(false)

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo ? preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) : null).toBe('status')
    expect(openWorkspacePaneView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
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
