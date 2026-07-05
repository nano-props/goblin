import { describe, expect, test, vi } from 'vitest'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'

describe('createPrimaryWindowNavigationActions', () => {
  test('updates branch workspace tab preference explicitly', () => {
    const setWorkspacePaneTab = vi.fn()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b'],
      closeRepo: vi.fn(),
      setWorkspacePaneTab,
      routeNavigation: routeNavigation(),
    })

    actions.showRepoBranchWorkspacePaneTab('/tmp/repo-b', 'feature/test', 'terminal')

    expect(setWorkspacePaneTab).toHaveBeenCalledWith('/tmp/repo-b', 'feature/test', 'terminal')
  })

  test('cycles repos by navigating from the current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-a',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo: vi.fn(),
      setWorkspacePaneTab: vi.fn(),
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
      setWorkspacePaneTab: vi.fn(),
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
      setWorkspacePaneTab: vi.fn(),
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
      setWorkspacePaneTab: vi.fn(),
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
      setWorkspacePaneTab: vi.fn(),
      routeNavigation: navigation,
    })

    actions.closeRepo('/tmp/repo-a')

    expect(navigation.openHome).toHaveBeenCalled()
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
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}
