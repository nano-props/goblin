import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type {
  WorkspacePaneBranchViewType,
  WorkspacePaneStaticViewType,
  WorkspacePaneWorktreeStaticViewType,
} from '#/shared/workspace-pane.ts'
import { branchWorkspacePaneViewsForBranch } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'

const REPO_ID = '/tmp/workspace-pane-view-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-view-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`
const originalRefreshStatus = useReposStore.getState().refreshStatus

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  setTerminalSessionCommandBridge(null)
  resetReposStore()
  useReposStore.setState({ refreshStatus: originalRefreshStatus })
})

describe('openWorkspacePaneView', () => {
  test('opens status as a branch-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')
    useReposStore.getState().closeBranchWorkspacePaneView(REPO_ID, 'status')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openStaticView).not.toHaveBeenCalled()
    expect(openViewsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneView()).toBe('status')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('registers changes as a worktree-level view and refreshes status', async () => {
    seedWorktreeRepo('changes')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(preferredWorkspacePaneView()).toBe('changes')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('does not select changes when the runtime open fails', async () => {
    seedWorktreeRepo('status')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const openStaticView = vi.fn(async () => false)
    setWorkspacePaneBridge(openStaticView)

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(preferredWorkspacePaneView()).toBe('status')
    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'changes',
    })
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openStaticView).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneView()).toBe('status')
  })

  test('opens history as a branch-static workspace pane view', async () => {
    seedWorktreeRepo('history')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openStaticView).not.toHaveBeenCalled()
    expect(openViewsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneView()).toBe('history')
    expect(refreshStatus).not.toHaveBeenCalled()
  })
})

function seedWorktreeRepo(preferredWorkspacePaneView: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType) {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    preferredWorkspacePaneView,
  })
}

function openViewsFor(branchName: string): WorkspacePaneBranchViewType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? branchWorkspacePaneViewsForBranch(repo.ui, branchName) : []
}

function preferredWorkspacePaneView() {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) : null
}

function navigationWithStoreActions(): Pick<
  MainWindowNavigationActions,
  'showRepoBranchWorkspacePaneView' | 'showRepoWorkspacePaneView'
> {
  return {
    showRepoBranchWorkspacePaneView: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneView(repoId, tab)
    },
    showRepoWorkspacePaneView: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneView(repoId, tab)
    },
  }
}

function setWorkspacePaneBridge(
  openWorkspacePaneView: (worktreeKey: string, type: WorkspacePaneWorktreeStaticViewType) => Promise<boolean>,
) {
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
}
