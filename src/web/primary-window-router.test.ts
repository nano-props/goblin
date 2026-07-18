// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { createElement, Fragment, type ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const appMocks = vi.hoisted(() => ({ render: vi.fn() }))

vi.mock('#/web/App.tsx', () => ({
  App: (props: { routeRepoView?: { kind: string } | null }) => {
    appMocks.render(props.routeRepoView?.kind ?? null)
    return createElement('div', { 'data-testid': 'routed-app' }, props.routeRepoView?.kind ?? 'none')
  },
}))

vi.mock('#/web/Layout.tsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/Layout.tsx')>()
  return {
    ...actual,
    Layout: () => createElement(Outlet),
    WorkspaceSessionRestoreGate: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  }
})
import {
  initialRepoRouteSlugFromStore,
  repoRouteViewFromChildRoute,
  repoRouteViewFromSlugChildRoute,
  primaryWindowRouterCallbacks,
  applyPrimaryWindowSettingsRouteChange,
  PrimaryWindowRouterProvider,
} from '#/web/primary-window-router.tsx'
import { repoSlugFromId, worktreeSlugFromPath } from '#/web/repo-route-slugs.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
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
import { resetWorkspacesStore } from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  appMocks.render.mockClear()
  vi.restoreAllMocks()
})

describe('primary window initial route', () => {
  test('prefers the restored repo over the first repo in order', () => {
    const repoA = emptyWorkspace('goblin+file:///repo-a', 'repo-a', 'repo-runtime-a')
    const repoB = emptyWorkspace('goblin+file:///repo-b', 'repo-b', 'repo-runtime-b')

    expect(
      initialRepoRouteSlugFromStore({
        restoredWorkspaceId: 'goblin+file:///repo-b',
        workspaceOrder: ['goblin+file:///repo-a', 'goblin+file:///repo-b'],
        workspaces: { 'goblin+file:///repo-a': repoA, 'goblin+file:///repo-b': repoB },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId('goblin+file:///repo-b'))
  })

  test('waits for workspace membership restore instead of routing to the first partial repo', () => {
    const repoA = emptyWorkspace('goblin+file:///repo-a', 'repo-a', 'repo-runtime-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredWorkspaceId: null,
        workspaceOrder: ['goblin+file:///repo-a'],
        workspaces: { 'goblin+file:///repo-a': repoA },
        workspaceMembershipReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered repo when restore has settled without a restored repo', () => {
    const repoA = emptyWorkspace('goblin+file:///repo-a', 'repo-a', 'repo-runtime-a')

    expect(
      initialRepoRouteSlugFromStore({
        restoredWorkspaceId: 'goblin+file:///missing',
        workspaceOrder: ['goblin+file:///repo-a'],
        workspaces: { 'goblin+file:///repo-a': repoA },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId('goblin+file:///repo-a'))
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
    expect(
      repoRouteViewFromChildRoute('/repo', {
        dashboard: false,
        workspace: true,
        branchSlug: null,
        newWorktree: false,
      }),
    ).toEqual({ kind: 'workspace-root', repoId: '/repo' })
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

  test('maps a detached worktree terminal URL to a filesystem surface', () => {
    expect(
      repoRouteViewFromChildRoute('goblin+file:///workspace/repo', {
        dashboard: false,
        branchSlug: null,
        worktreeSlug: worktreeSlugFromPath('/workspace/detached'),
        worktreeTerminalSessionId: 'term-333333333333333333333',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'worktree',
      repoId: 'goblin+file:///workspace/repo',
      worktreePath: '/workspace/detached',
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-333333333333333333333' },
    })
  })
})

describe('repo route capability admission', () => {
  test.each([
    ['branch surface', (repoSlug: string) => `/repo/${repoSlug}/branch/bWFpbg`],
    ['new-worktree surface', (repoSlug: string) => `/repo/${repoSlug}/worktree/new`],
  ])('redirects a non-Git %s to Dashboard without mounting the rejected surface', async (_label, pathForSlug) => {
    const repoId = 'goblin+file:///tmp/plain-router-workspace'
    seedRepoCapability(repoId, 'unavailable')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(pathForSlug(repoSlugFromId(repoId)))

    await waitFor(() => expect(window.location.pathname).toBe(`/repo/${repoSlugFromId(repoId)}/dashboard`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('dashboard'))
    expect(appMocks.render).not.toHaveBeenCalledWith('branch')
    expect(appMocks.render).not.toHaveBeenCalledWith('newWorktree')
  })

  test('keeps an explicitly selected workspace surface when Git capability becomes available', async () => {
    const repoId = 'goblin+file:///tmp/git-router-workspace'
    seedRepoCapability(repoId, 'available')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(`/repo/${repoSlugFromId(repoId)}/workspace`)

    await waitFor(() => expect(window.location.pathname).toBe(`/repo/${repoSlugFromId(repoId)}/workspace`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
    expect(appMocks.render).not.toHaveBeenCalledWith('dashboard')
  })
})

function seedRepoCapability(repoId: string, gitStatus: 'available' | 'unavailable') {
  resetWorkspacesStore()
  const repo = emptyWorkspace(repoId, 'workspace', 'runtime-router-test')
  acceptWorkspaceProbeState(repo, {
    status: 'ready',
    name: 'workspace',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git:
        gitStatus === 'available'
          ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
          : { status: 'unavailable' },
    },
    diagnostics: [],
  })
  useWorkspacesStore.setState({
    workspaces: { [repoId]: repo },
    workspaceOrder: [repoId],
    workspaceMembershipReady: true,
  })
}

function navigateBrowser(pathname: string) {
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

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
      openWorkspaceRootPane: vi.fn(),
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
