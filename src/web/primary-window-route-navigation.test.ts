import { describe, expect, test, vi } from 'vitest'
import {
  returnToFromHref,
  parsedWorkspacePaneRouteFromTargetHref,
  routeReturnSearch,
  settleOwnedPrimaryWindowRouteCommit,
  settlePrimaryWindowRouteCommit,
  workspacePaneRouteFromBranchHref,
} from '#/web/primary-window-route-navigation.ts'
import {
  beginPrimaryWindowPresentation,
  observePrimaryWindowHistoryNavigation,
  primaryWindowNavigationState,
} from '#/web/primary-window-presentation.ts'

describe('primary window route navigation helpers', () => {
  test('settles an awaited owned navigation when a newer presentation abandons it', async () => {
    const navigation = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const committed = settleOwnedPrimaryWindowRouteCommit({
      targetHref: '/workspace/example/branch/main/tab/status',
      currentHref: () => '/workspace/example/branch/main',
      navigate: async () => {
        started.resolve()
        await navigation.promise
      },
    })
    await started.promise

    beginPrimaryWindowPresentation()

    await expect(committed).resolves.toBe(false)
    navigation.resolve()
    await navigation.promise
    await Promise.resolve()
  })

  test('propagates a routed commit effect failure through the awaited transaction', async () => {
    let currentHref = '/start'
    const committed = settleOwnedPrimaryWindowRouteCommit({
      targetHref: '/target',
      currentHref: () => currentHref,
      commitEffect: () => {
        throw new Error('commit effect failed')
      },
      navigate: async (navigationId) => {
        currentHref = '/target'
        observePrimaryWindowHistoryNavigation({
          href: currentHref,
          state: primaryWindowNavigationState({}, navigationId),
          action: { type: 'PUSH' },
        })
      },
    })

    await expect(committed).rejects.toThrow('commit effect failed')
  })

  test('propagates an abandon effect failure after a newer presentation supersedes the route', async () => {
    const navigation = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const committed = settleOwnedPrimaryWindowRouteCommit({
      targetHref: '/target',
      currentHref: () => '/start',
      abandonEffect: () => {
        throw new Error('abandon effect failed')
      },
      navigate: async () => {
        started.resolve()
        await navigation.promise
      },
    })
    await started.promise

    beginPrimaryWindowPresentation()

    await expect(committed).rejects.toThrow('abandon effect failed')
    navigation.resolve()
  })

  test('accepts an operation route only after navigation lands on the requested href', async () => {
    let currentHref = '/workspace/example/branch/main'

    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/workspace/example/branch/main/tab/status',
        navigate: async () => {
          currentHref = '/workspace/example/branch/main/tab/status'
        },
        currentHref: () => currentHref,
      }),
    ).resolves.toBe(true)
  })

  test('rejects an operation route when navigation is superseded', async () => {
    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/workspace/example/branch/main/tab/status',
        navigate: async () => {},
        currentHref: () => '/workspace/example/branch/main/tab/history',
      }),
    ).resolves.toBe(false)
  })

  test('rejects a stale source-route precondition without navigating', async () => {
    const navigate = vi.fn(async () => {})

    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/workspace/example/branch/main/tab/history',
        expectedCurrentHref: '/workspace/example/branch/main/tab/files',
        navigate,
        currentHref: () => '/workspace/example/branch/main/tab/status',
      }),
    ).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  test('rejects an owned fast-path commit when its source-route precondition is stale', async () => {
    const navigate = vi.fn(async () => {})
    const commitEffect = vi.fn()
    const abandonEffect = vi.fn()

    await expect(
      settleOwnedPrimaryWindowRouteCommit({
        targetHref: '/workspace/example/branch/main/terminal/term-2',
        expectedCurrentHref: '/workspace/example/branch/main/terminal/term-1',
        navigate,
        currentHref: () => '/workspace/example/branch/main/terminal/term-2',
        commitEffect,
        abandonEffect,
      }),
    ).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(commitEffect).not.toHaveBeenCalled()
    expect(abandonEffect).toHaveBeenCalledOnce()
  })

  test('reads the current workspace pane route only for the exact repo branch', () => {
    const branchRoot = '/workspace/example/branch/main'
    expect(workspacePaneRouteFromBranchHref(branchRoot, branchRoot)).toBeNull()
    expect(workspacePaneRouteFromBranchHref(`${branchRoot}/tab/files`, branchRoot)).toEqual({
      kind: 'static',
      tab: 'files',
    })
    expect(workspacePaneRouteFromBranchHref(`${branchRoot}/terminal/term-1`, branchRoot)).toEqual({
      kind: 'terminal',
      terminalSessionId: 'term-1',
    })
    expect(workspacePaneRouteFromBranchHref('/workspace/example/branch/other/tab/files', branchRoot)).toBeUndefined()
    expect(workspacePaneRouteFromBranchHref(`${branchRoot}/tab/not-a-tab`, branchRoot)).toBeUndefined()
    expect(workspacePaneRouteFromBranchHref(`${branchRoot}/tab/files/extra`, branchRoot)).toBeUndefined()
    expect(parsedWorkspacePaneRouteFromTargetHref(`${branchRoot}/tab/not%20a%20tab`, branchRoot)).toEqual({
      kind: 'invalid-static',
      tabKey: 'not a tab',
    })
  })

  test('propagates an operation route navigation failure', async () => {
    await expect(
      settlePrimaryWindowRouteCommit({
        targetHref: '/workspace/example/branch/main/tab/status',
        navigate: async () => {
          throw new Error('navigation failed')
        },
        currentHref: () => '/workspace/example/branch/main',
      }),
    ).rejects.toThrow('navigation failed')
  })

  test('records a route return target when opening a different route', () => {
    expect(
      routeReturnSearch('/workspace/workspace-slug/branch/branch-slug', '/workspace/workspace-slug/worktree/new'),
    ).toEqual({
      returnTo: '/workspace/workspace-slug/branch/branch-slug',
    })
  })

  test('records the workspace route as a return target when opening a new worktree', () => {
    expect(routeReturnSearch('/workspace/workspace-slug', '/workspace/workspace-slug/worktree/new')).toEqual({
      returnTo: '/workspace/workspace-slug',
    })
  })

  test('does not record the current route as its own return target', () => {
    expect(
      routeReturnSearch('/workspace/workspace-slug/worktree/new', '/workspace/workspace-slug/worktree/new'),
    ).toEqual({})
  })

  test('preserves an existing return target when re-entering the same route', () => {
    expect(
      routeReturnSearch(
        '/workspace/workspace-slug/worktree/new?returnTo=%2Fworkspace%2Fworkspace-slug%2Fbranch%2Fbranch-slug',
        '/workspace/workspace-slug/worktree/new',
      ),
    ).toEqual({ returnTo: '/workspace/workspace-slug/branch/branch-slug' })
  })

  test('preserves an existing return target while navigating inside a route family', () => {
    expect(
      routeReturnSearch(
        '/settings/general?returnTo=%2Fworkspace%2Fworkspace-slug%2Fdashboard',
        '/settings',
        '/settings',
      ),
    ).toEqual({
      returnTo: '/workspace/workspace-slug/dashboard',
    })
  })

  test('reads a same-origin relative return target from the current href', () => {
    expect(
      returnToFromHref(
        '/workspace/workspace-slug/worktree/new?returnTo=%2Fworkspace%2Fworkspace-slug%2Fbranch%2Fbranch-slug',
      ),
    ).toBe('/workspace/workspace-slug/branch/branch-slug')
  })

  test('ignores external return targets', () => {
    expect(returnToFromHref('/settings/general?returnTo=https%3A%2F%2Fexample.invalid')).toBeNull()
  })

  test('ignores protocol-relative return targets', () => {
    expect(returnToFromHref('/settings/general?returnTo=%2F%2Fexample.invalid')).toBeNull()
  })
})
