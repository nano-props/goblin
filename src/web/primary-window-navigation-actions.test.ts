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

  test('closes the repo through the store action', () => {
    const closeRepo = vi.fn()
    const actions = createPrimaryWindowNavigationActions({
      currentRepoId: '/tmp/repo-b',
      order: ['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'],
      closeRepo,
      setWorkspacePaneTab: vi.fn(),
      routeNavigation: routeNavigation(),
    })

    actions.closeRepo('/tmp/repo-b')

    expect(closeRepo).toHaveBeenCalledWith('/tmp/repo-b')
  })
})

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    repoSlugForId: vi.fn(() => 'repo-slug'),
    openSettings: vi.fn(),
    openRepoDashboard: vi.fn(),
    openRepoBranch: vi.fn(),
    openRepoNewWorktree: vi.fn(),
  }
}
