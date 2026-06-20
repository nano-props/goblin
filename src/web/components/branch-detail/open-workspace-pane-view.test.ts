import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneView } from '#/web/components/branch-detail/open-workspace-pane-view.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

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
  test.each(['status', 'changes'] as const)(
    'requests a status refresh when opening the already-preferred %s view',
    (type) => {
      seedWorktreeRepo(type)
      const refreshStatus = vi.fn(async () => {})
      useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
      const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
      const openStaticView = vi.fn(async () => true)
      setWorkspacePaneBridge(openStaticView)

      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type,
        navigation: navigationWithStoreActions(),
      })

      expect(openStaticView).toHaveBeenCalledWith(WORKTREE_KEY, type)
      expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
    },
  )
})

function seedWorktreeRepo(workspacePaneView: WorkspacePaneStaticViewType) {
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
      pendingCreate: false,
    }),
    createTerminal: vi.fn(async () => 'terminal-1'),
    selectTerminal: vi.fn(),
    openWorkspacePaneView,
    closeWorkspacePaneView: vi.fn(async () => true),
    reorderWorkspacePaneViews: vi.fn(async () => true),
  })
}
