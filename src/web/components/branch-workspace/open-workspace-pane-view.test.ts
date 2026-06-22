import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneView } from '#/web/components/branch-workspace/open-workspace-pane-view.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticViewsForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'

const REPO_ID = '/tmp/workspace-pane-view-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-view-worktree'
const originalRefreshStatus = useReposStore.getState().refreshStatus

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  resetReposStore()
  useReposStore.setState({ refreshStatus: originalRefreshStatus })
})

describe('openWorkspacePaneView', () => {
  test('opens status as a branch-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')
    useReposStore.getState().closeWorkspacePaneStaticView(REPO_ID, 'status')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneView()).toBe('status')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('registers changes as a workspace pane static tab and refreshes status', async () => {
    seedWorktreeRepo('changes')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneView()).toBe('changes')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('does not select changes when the selected branch has no worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'status',
    })
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(preferredWorkspacePaneView()).toBe('status')
    expect(openViewsFor('feature/no-worktree')).toEqual(['status'])
    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'changes',
    })

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(preferredWorkspacePaneView()).toBe('status')
  })

  test('opens history as a branch-static workspace pane view', async () => {
    seedWorktreeRepo('history')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })

    await expect(
      openWorkspacePaneView({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneView()).toBe('history')
    expect(refreshStatus).not.toHaveBeenCalled()
  })
})

function seedWorktreeRepo(preferredWorkspacePaneView: WorkspacePaneStaticViewType) {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    preferredWorkspacePaneView,
  })
}

function openViewsFor(branchName: string): WorkspacePaneStaticViewType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticViewsForBranch(repo.ui, branchName) : []
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
