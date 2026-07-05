import { describe, expect, test } from 'vitest'
import { returnToFromHref, routeReturnSearch } from '#/web/primary-window-route-navigation.ts'

describe('primary window route navigation helpers', () => {
  test('records a route return target when opening a different route', () => {
    expect(routeReturnSearch('/repo/repo-slug/branch/branch-slug', '/repo/repo-slug/worktree/new')).toEqual({
      returnTo: '/repo/repo-slug/branch/branch-slug',
    })
  })

  test('does not record the current route as its own return target', () => {
    expect(routeReturnSearch('/repo/repo-slug/worktree/new', '/repo/repo-slug/worktree/new')).toEqual({})
  })

  test('preserves an existing return target when re-entering the same route', () => {
    expect(
      routeReturnSearch(
        '/repo/repo-slug/worktree/new?returnTo=%2Frepo%2Frepo-slug%2Fbranch%2Fbranch-slug',
        '/repo/repo-slug/worktree/new',
      ),
    ).toEqual({ returnTo: '/repo/repo-slug/branch/branch-slug' })
  })

  test('preserves an existing return target while navigating inside a route family', () => {
    expect(routeReturnSearch('/settings/general?returnTo=%2Frepo%2Frepo-slug%2Fdashboard', '/settings', '/settings')).toEqual({
      returnTo: '/repo/repo-slug/dashboard',
    })
  })

  test('reads a same-origin relative return target from the current href', () => {
    expect(returnToFromHref('/repo/repo-slug/worktree/new?returnTo=%2Frepo%2Frepo-slug%2Fbranch%2Fbranch-slug')).toBe(
      '/repo/repo-slug/branch/branch-slug',
    )
  })

  test('ignores external return targets', () => {
    expect(returnToFromHref('/settings/general?returnTo=https%3A%2F%2Fexample.invalid')).toBeNull()
  })
})
