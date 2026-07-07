import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'

const REPO_ID = '/tmp/navigation-actions-repo'
const BRANCH_NAME = 'feature/create-pending'
const WORKTREE_PATH = '/tmp/navigation-actions-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
})

describe('createPrimaryWindowNavigationActions', () => {
  test('opens bare branch routes through route navigation', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch('/tmp/repo-b', 'feature/test', { replace: true })

    expect(navigation.openRepoBranch).toHaveBeenCalledWith('/tmp/repo-b', 'feature/test', { replace: true })
  })

  test('opens branch workspace static tabs through route navigation', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchWorkspacePaneTab('/tmp/repo-b', 'feature/test', 'history')

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith('/tmp/repo-b', 'feature/test', 'history')
  })

  test('opens branch terminal sessions through route navigation', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchTerminalSession('/tmp/repo-b', 'feature/test', 'session-1')

    expect(navigation.openRepoBranchTerminal).toHaveBeenCalledWith('/tmp/repo-b', 'feature/test', 'session-1')
  })

  test('blocks workspace pane route navigation while terminal creation is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: REPO_ID,
      order: [REPO_ID],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchWorkspacePaneTab(REPO_ID, BRANCH_NAME, 'history')
    actions.showRepoBranchTerminalSession(REPO_ID, BRANCH_NAME, 'session-1')

    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('blocks workspace history restore before mutating history while terminal creation is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const dashboard = {
      repoId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    const branch = {
      repoId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: 'status',
        terminalWorktreeKey: WORKTREE_KEY,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    useReposStore.getState().recordWorkspaceNavigation(dashboard)
    useReposStore.getState().recordWorkspaceNavigation(branch)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const goBackInWorkspaceNavigation = vi.fn((repoId: string) =>
      useReposStore.getState().goBackInWorkspaceNavigation(repoId),
    )
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: REPO_ID,
      order: [REPO_ID],
      closeRepo: vi.fn(),
      goBackInWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(goBackInWorkspaceNavigation).not.toHaveBeenCalled()
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(branch)
  })

  test('cycles repos by navigating from the current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleRepo(1)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('/tmp/repo-b')
  })

  test('cycles repos backward and wraps around', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleRepo(-1)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('/tmp/repo-c')
  })

  test('closes the repo through the store action without navigation when it is not current', () => {
    const closeRepo = vi.fn()
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo,
      routeNavigation: navigation,
    })

    actions.closeRepo('/tmp/repo-b')

    expect(closeRepo).toHaveBeenCalledWith('/tmp/repo-b')
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
  })

  test('closes the current repo and navigates to the next repo dashboard', () => {
    const closeRepo = vi.fn()
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-b',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo,
      routeNavigation: navigation,
    })

    actions.closeRepo('/tmp/repo-b')

    expect(closeRepo).toHaveBeenCalledWith('/tmp/repo-b')
    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('/tmp/repo-c')
  })

  test('closes the final current repo and navigates home', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.closeRepo('/tmp/repo-a')

    expect(navigation.openHome).toHaveBeenCalled()
  })

  test('opens create worktree for the current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a'],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith('/tmp/repo-a')
  })

  test('restores a saved new-worktree return target when navigating workspace history', () => {
    const navigation = routeNavigation()
    const goBackInWorkspaceNavigation = vi.fn(() => ({
      repoId: '/tmp/repo-a',
      route: { kind: 'newWorktree' as const, returnTo: '/repo/repo-a/branch/main' },
    }))
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a'],
      closeRepo: vi.fn(),
      goBackInWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack('/tmp/repo-a')

    expect(goBackInWorkspaceNavigation).toHaveBeenCalledWith('/tmp/repo-a')
    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith('/tmp/repo-a', {
      returnTo: '/repo/repo-a/branch/main',
    })
  })

  test('restores a saved bare branch workspace history entry', () => {
    const navigation = routeNavigation()
    const goBackInWorkspaceNavigation = vi.fn(() => ({
      repoId: '/tmp/repo-a',
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalWorktreeKey: null,
        terminalSessionId: null,
      },
    }))
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a'],
      closeRepo: vi.fn(),
      goBackInWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack('/tmp/repo-a')

    expect(goBackInWorkspaceNavigation).toHaveBeenCalledWith('/tmp/repo-a')
    expect(navigation.openRepoBranch).toHaveBeenCalledWith('/tmp/repo-a', 'feature/test')
  })

  test('does not open create worktree without a current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: null,
      order: [],
      closeRepo: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })
})

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    repoSlugForId: vi.fn(() => 'repo-slug'),
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openRepoRoot: vi.fn(),
    openRepoDashboard: vi.fn(),
    openRepoBranch: vi.fn(),
    openRepoBranchTab: vi.fn(),
    openRepoBranchTerminal: vi.fn(),
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}

function createPendingWorktreeSnapshot(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: true,
  }
}
