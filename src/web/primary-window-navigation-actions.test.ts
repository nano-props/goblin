import { describe, expect, test, vi } from 'vitest'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'

describe('createPrimaryWindowNavigationActions', () => {
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
