import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import type { MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticViewsForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'

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

describe('openWorkspacePaneTab', () => {
  test('opens status as a branch-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')
    useReposStore.getState().closeWorkspacePaneStaticView(REPO_ID, 'status')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('registers changes as a workspace pane static tab and refreshes status', async () => {
    seedWorktreeRepo('changes')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
  })

  test('does not select changes when the selected branch has no worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(openViewsFor('feature/no-worktree')).toEqual(['status'])
    expect(refreshStatus).not.toHaveBeenCalled()
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'changes',
    })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('opens history as a branch-static workspace pane view', async () => {
    seedWorktreeRepo('history')
    const refreshStatus = vi.fn(async () => {})
    useReposStore.setState({ refreshStatus: refreshStatus as typeof originalRefreshStatus })

    await expect(
      openWorkspacePaneTab({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openViewsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(refreshStatus).not.toHaveBeenCalled()
  })
})

function seedWorktreeRepo(preferredWorkspacePaneTab: WorkspacePaneStaticTabType) {
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    selectedBranch: 'feature/worktree',
    preferredWorkspacePaneTab,
  })
}

function openViewsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticViewsForBranch(repo.ui, branchName) : []
}

function preferredWorkspacePaneTab() {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) : null
}

function navigationWithStoreActions(): Pick<
  MainWindowNavigationActions,
  'showRepoBranchWorkspacePaneTab' | 'showRepoWorkspacePaneTab'
> {
  return {
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneTab(repoId, tab)
    },
    showRepoWorkspacePaneTab: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneTab(repoId, tab)
    },
  }
}
