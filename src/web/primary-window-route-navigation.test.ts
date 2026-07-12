import { describe, expect, test, vi } from 'vitest'
import {
  returnToFromHref,
  routeReturnSearch,
  settlePrimaryWindowRouteCommit,
} from '#/web/primary-window-route-navigation.ts'

describe('primary window route navigation helpers', () => {
  test('accepts an operation route only after navigation lands on the requested href', async () => {
    let currentHref = '/repo/example/branch/main'

    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/repo/example/branch/main/tab/status',
        navigate: async () => {
          currentHref = '/repo/example/branch/main/tab/status'
        },
        currentHref: () => currentHref,
      }),
    ).resolves.toBe(true)
  })

  test('rejects an operation route when navigation is superseded', async () => {
    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/repo/example/branch/main/tab/status',
        navigate: async () => {},
        currentHref: () => '/repo/example/branch/main/tab/history',
      }),
    ).resolves.toBe(false)
  })

  test('rejects a stale source-route precondition without navigating', async () => {
    const navigate = vi.fn(async () => {})

    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/repo/example/branch/main/tab/history',
        expectedCurrentHref: '/repo/example/branch/main/tab/files',
        navigate,
        currentHref: () => '/repo/example/branch/main/tab/status',
      }),
    ).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  test('rejects an operation route when navigation throws', async () => {
    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/repo/example/branch/main/tab/status',
        navigate: async () => {
          throw new Error('navigation failed')
        },
        currentHref: () => '/repo/example/branch/main',
      }),
    ).resolves.toBe(false)
  })

  test('records a route return target when opening a different route', () => {
    expect(routeReturnSearch('/repo/repo-slug/branch/branch-slug', '/repo/repo-slug/worktree/new')).toEqual({
      returnTo: '/repo/repo-slug/branch/branch-slug',
    })
  })

  test('records repo root as a return target when opening new worktree from the empty repo route', () => {
    expect(routeReturnSearch('/repo/repo-slug', '/repo/repo-slug/worktree/new')).toEqual({
      returnTo: '/repo/repo-slug',
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
    expect(
      routeReturnSearch('/settings/general?returnTo=%2Frepo%2Frepo-slug%2Fdashboard', '/settings', '/settings'),
    ).toEqual({
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

  test('ignores protocol-relative return targets', () => {
    expect(returnToFromHref('/settings/general?returnTo=%2F%2Fexample.invalid')).toBeNull()
  })
})
