import { describe, expect, test } from 'vitest'
import {
  initialRepoRouteSlugFromStore,
  repoRouteViewFromChildRoute,
  repoRouteViewFromSlugChildRoute,
} from '#/web/primary-window-router.tsx'
import { repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { repoRouteContextFromMatches } from '#/web/Layout.tsx'

describe('primary window initial route', () => {
  test('prefers the restored repo over the first repo in order', () => {
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')
    const repoB = emptyRepo('/repo-b', 'repo-b', 'repo-instance-b')

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
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')

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
    const repoA = emptyRepo('/repo-a', 'repo-a', 'repo-instance-a')

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
        terminalSessionId: 'session-1',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      repoId: '/repo',
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'session-1' },
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
