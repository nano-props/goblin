import { describe, expect, test, vi } from 'vitest'
import {
  initialRepoRouteSlugFromStore,
  repoRouteViewFromChildRoute,
  repoRouteViewFromSlugChildRoute,
  primaryWindowRouterCallbacks,
  applyPrimaryWindowSettingsRouteChange,
} from '#/web/primary-window-router.tsx'
import { repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  authenticatedAppShellMode,
  primaryWindowLayoutRouteCallbacks,
  repoRouteContextFromMatches,
} from '#/web/Layout.tsx'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import {
  beginPrimaryWindowPresentation,
  observePrimaryWindowHistoryNavigation,
  primaryWindowPresentationIsCurrent,
  resetPrimaryWindowPresentationForTest,
} from '#/web/primary-window-presentation.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'

describe('primary window initial route', () => {
  test('prefers the restored repo over the first repo in order', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-runtime-a')
    const repoB = emptyRepo('/repo-b', 'repo-b', 'repo-runtime-b')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: '/repo-b',
        order: ['/repo-a', '/repo-b'],
        repos: { '/repo-a': repoA, '/repo-b': repoB },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId('/repo-b'))
  })

  test('waits for workspace membership restore instead of routing to the first partial repo', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-runtime-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: null,
        order: ['/repo-a'],
        repos: { '/repo-a': repoA },
        workspaceMembershipReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered repo when restore has settled without a restored repo', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-runtime-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredRepoId: '/missing',
        order: ['/repo-a'],
        repos: { '/repo-a': repoA },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId('/repo-a'))
  })
})

describe('repo route view derivation', () => {
  test('derives a routed repo view directly from the URL slug without store hydration', () => {
    const repoSlug = repoSlugFromId('/deep-link/repo')

    expect(
      repoRouteViewFromSlugChildRoute(repoSlug, { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'dashboard',
      repoId: '/deep-link/repo',
    })
  })

  test('returns null only when the repo slug itself is invalid', () => {
    expect(repoRouteViewFromSlugChildRoute('%', { dashboard: true, branchSlug: null, newWorktree: false })).toBeNull()
  })

  test('uses the repo root as an empty route view', () => {
    expect(repoRouteViewFromChildRoute('/repo', { dashboard: false, branchSlug: null, newWorktree: false })).toEqual({
      kind: 'empty',
      repoId: '/repo',
    })
  })

  test('maps repo child routes to stable repo route views', () => {
    expect(repoRouteViewFromChildRoute('/repo', { dashboard: true, branchSlug: null, newWorktree: false })).toEqual({
      kind: 'dashboard',
      repoId: '/repo',
    })
    expect(repoRouteViewFromChildRoute('/repo', { dashboard: false, branchSlug: null, newWorktree: true })).toEqual({
      kind: 'newWorktree',
      repoId: '/repo',
    })
    expect(
      repoRouteViewFromChildRoute('/repo', { dashboard: false, branchSlug: 'ZmVhdHVyZS9h', newWorktree: false }),
    ).toEqual({
      kind: 'branch',
      repoId: '/repo',
      branchName: 'feature/a',
      workspacePaneRoute: null,
    })
  })

  test('maps branch workspace pane child routes to stable route views', () => {
    expect(
      repoRouteViewFromChildRoute('/repo', {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        tabKey: 'history',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      repoId: '/repo',
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'static', tab: 'history' },
    })
    expect(
      repoRouteViewFromChildRoute('/repo', {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        tabKey: 'not-a-tab',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      repoId: '/repo',
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'invalid-static', tabKey: 'not-a-tab' },
    })
    expect(
      repoRouteViewFromChildRoute('/repo', {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        terminalSessionId: 'term-111111111111111111111',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      repoId: '/repo',
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
  })
})

describe('repo route context derivation', () => {
  test('keeps repo context when a branch slug is malformed', () => {
    expect(
      repoRouteContextFromMatches([
        { routeId: '/repo/$repoSlug/branch/$branchSlug', params: { repoSlug: 'L3JlcG8', branchSlug: '%' } },
      ]),
    ).toEqual({ kind: 'empty', repoSlug: 'L3JlcG8' })
  })
})

describe('primary window route callback facades', () => {
  test('router and Layout callbacks delegate every primary write to arbiter-aware route actions', () => {
    const routeActions = {
      openHome: vi.fn(),
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      openRepoRoot: vi.fn(),
      openRepoDashboard: vi.fn(),
      openRepoBranch: vi.fn(() => true),
      openRepoBranchTab: vi.fn(() => true),
      openRepoBranchTerminal: vi.fn(() => true),
      openRepoNewWorktree: vi.fn(),
      cancelRepoNewWorktree: vi.fn(),
      repoSlugForId: vi.fn(),
    } as unknown as PrimaryWindowRouteNavigation
    const routerCallbacks = primaryWindowRouterCallbacks(routeActions)
    const layoutCallbacks = primaryWindowLayoutRouteCallbacks(routeActions)

    routerCallbacks.onRouteSettingsPageChange('general')
    routerCallbacks.onOpenRepoRoot('/repo')
    routerCallbacks.onOpenRepoDashboard('/repo')
    routerCallbacks.onOpenRepoBranch('/repo', 'main')
    routerCallbacks.onOpenRepoNewWorktree('/repo')
    routerCallbacks.onCancelRepoNewWorktree('/repo')
    routerCallbacks.onReplaceRepoBranch('/repo', 'main')
    applyPrimaryWindowSettingsRouteChange(routeActions, null)
    layoutCallbacks.navigateToSettingsShortcuts()
    layoutCallbacks.navigateToIndex()

    expect(routeActions.openSettings).toHaveBeenNthCalledWith(1, 'general')
    expect(routeActions.openSettings).toHaveBeenNthCalledWith(2, 'shortcuts')
    expect(routeActions.closeSettings).toHaveBeenCalledOnce()
    expect(routeActions.openRepoRoot).toHaveBeenCalledWith('/repo')
    expect(routeActions.openRepoDashboard).toHaveBeenCalledWith('/repo')
    expect(routeActions.openRepoNewWorktree).toHaveBeenCalledWith('/repo')
    expect(routeActions.cancelRepoNewWorktree).toHaveBeenCalledWith('/repo')
    expect(routeActions.openHome).toHaveBeenCalledOnce()
  })

  test.each([
    ['/settings/general', { status: 'ready' as const }],
    ['/', { status: 'restoring-workspace' as const }],
  ])('browser traversal supersedes independently of conditional shell mode at %s', (pathname, bootstrapState) => {
    resetPrimaryWindowPresentationForTest()
    authenticatedAppShellMode(pathname, bootstrapState as AuthenticatedAppBootstrapState)
    const token = beginPrimaryWindowPresentation()

    observePrimaryWindowHistoryNavigation({ href: '/', state: {}, action: { type: 'BACK' } })

    expect(primaryWindowPresentationIsCurrent(token)).toBe(false)
  })
})
