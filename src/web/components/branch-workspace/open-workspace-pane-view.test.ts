import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneBranchViewType, WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

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
  test('opens status as a static workspace pane view when the branch has a worktree', () => {
    seedWorktreeRepo('status')
    useReposStore.getState().closeBranchWorkspacePaneView(REPO_ID, 'status')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    openWorkspacePaneView({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'status',
      navigation: navigationWithStoreActions(),
    })

    expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, 'status')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toEqual(['status'])
    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('status')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('registers changes as a worktree-level view and refreshes status', () => {
    seedWorktreeRepo('changes')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    openWorkspacePaneView({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, 'changes')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('opens status for a branch without a worktree', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      workspacePaneView: 'changes',
    })
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    openWorkspacePaneView({
      repoId: REPO_ID,
      branchName: 'feature/no-worktree',
      worktreePath: null,
      type: 'status',
      navigation: navigationWithStoreActions(),
    })

    expect(openStaticView).not.toHaveBeenCalled()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('status')
  })

  test('opens history as a branch-static workspace pane view', () => {
    seedWorktreeRepo('history')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const openStaticView = vi.fn(async () => true)
    setWorkspacePaneBridge(openStaticView)

    openWorkspacePaneView({
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'history',
      navigation: navigationWithStoreActions(),
    })

    expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, 'history')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.openBranchWorkspacePaneViews).toContain('history')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredWorkspacePaneView).toBe('history')
    expect(refreshStatus).not.toHaveBeenCalled()
  })
})

function seedWorktreeRepo(workspacePaneView: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType) {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    workspacePaneView,
  })
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
  openWorkspacePaneView: (worktreeKey: string, type: WorkspacePaneStaticViewType) => Promise<boolean>,
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
