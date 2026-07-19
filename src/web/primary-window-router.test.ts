// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { createElement, Fragment, type ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const appMocks = vi.hoisted(() => ({ render: vi.fn() }))

vi.mock('#/web/App.tsx', () => ({
  App: (props: { routeWorkspaceView?: { kind: string } | null }) => {
    appMocks.render(props.routeWorkspaceView?.kind ?? null)
    return createElement('div', { 'data-testid': 'routed-app' }, props.routeWorkspaceView?.kind ?? 'none')
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
  initialWorkspaceRouteSlugFromStore,
  workspaceRouteViewFromChildRoute,
  workspaceRouteViewFromSlugChildRoute,
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
  workspaceRouteContextFromMatches,
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
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const REPO_A_ID = workspaceIdForTest('goblin+file:///repo-a')
const REPO_B_ID = workspaceIdForTest('goblin+file:///repo-b')
const MISSING_REPO_ID = workspaceIdForTest('goblin+file:///missing')
const WORKSPACE_REPO_ID = workspaceIdForTest('goblin+file:///workspace/repo')
const ROUTE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///route-workspace')
const DEEP_LINK_WORKSPACE_ID = workspaceIdForTest('goblin+file:///deep-link-workspace')

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
    const repoA = emptyWorkspace(REPO_A_ID, 'repo-a', 'repo-runtime-a')
    const repoB = emptyWorkspace(REPO_B_ID, 'repo-b', 'repo-runtime-b')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: REPO_B_ID,
        workspaceOrder: [REPO_A_ID, REPO_B_ID],
        workspaces: { [REPO_A_ID]: repoA, [REPO_B_ID]: repoB },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId(REPO_B_ID))
  })

  test('waits for workspace membership restore instead of routing to the first partial repo', () => {
    const repoA = emptyWorkspace(REPO_A_ID, 'repo-a', 'repo-runtime-a')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: null,
        workspaceOrder: [REPO_A_ID],
        workspaces: { [REPO_A_ID]: repoA },
        workspaceMembershipReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered repo when restore has settled without a restored repo', () => {
    const repoA = emptyWorkspace(REPO_A_ID, 'repo-a', 'repo-runtime-a')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: MISSING_REPO_ID,
        workspaceOrder: [REPO_A_ID],
        workspaces: { [REPO_A_ID]: repoA },
        workspaceMembershipReady: true,
      }),
    ).toBe(repoSlugFromId(REPO_A_ID))
  })
})

describe('workspace route view derivation', () => {
  test('derives a routed workspace view directly from the URL slug without store hydration', () => {
    const repoSlug = repoSlugFromId(DEEP_LINK_WORKSPACE_ID)

    expect(
      workspaceRouteViewFromSlugChildRoute(repoSlug, { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'dashboard',
      workspaceId: DEEP_LINK_WORKSPACE_ID,
    })
  })

  test('returns null only when the workspace URL slug itself is invalid', () => {
    expect(workspaceRouteViewFromSlugChildRoute('%', { dashboard: true, branchSlug: null, newWorktree: false })).toBeNull()
  })

  test('uses the workspace root as an empty route view', () => {
    expect(workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: null, newWorktree: false })).toEqual({
      kind: 'empty',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
  })

  test('maps child routes to stable workspace route views', () => {
    expect(workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: true, branchSlug: null, newWorktree: false })).toEqual({
      kind: 'dashboard',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        workspace: true,
        branchSlug: null,
        newWorktree: false,
      }),
    ).toEqual({ kind: 'workspace-root', workspaceId: ROUTE_WORKSPACE_ID })
    expect(workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: null, newWorktree: true })).toEqual({
      kind: 'newWorktree',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: 'ZmVhdHVyZS9h', newWorktree: false }),
    ).toEqual({
      kind: 'branch',
      workspaceId: ROUTE_WORKSPACE_ID,
      branchName: 'feature/a',
      workspacePaneRoute: null,
    })
  })

  test('maps branch workspace pane child routes to stable route views', () => {
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        tabKey: 'history',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      workspaceId: ROUTE_WORKSPACE_ID,
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'static', tab: 'history' },
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        tabKey: 'not-a-tab',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      workspaceId: ROUTE_WORKSPACE_ID,
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'invalid-static', tabKey: 'not-a-tab' },
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        terminalSessionId: 'term-111111111111111111111',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'branch',
      workspaceId: ROUTE_WORKSPACE_ID,
      branchName: 'feature/a',
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
  })

  test('maps a detached worktree terminal URL to a filesystem surface', () => {
    expect(
      workspaceRouteViewFromChildRoute(WORKSPACE_REPO_ID, {
        dashboard: false,
        branchSlug: null,
        worktreeSlug: worktreeSlugFromPath('/workspace/detached'),
        worktreeTerminalSessionId: 'term-333333333333333333333',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'worktree',
      workspaceId: WORKSPACE_REPO_ID,
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
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-router-workspace')
    seedRepoCapability(workspaceId, 'unavailable')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(pathForSlug(repoSlugFromId(workspaceId)))

    await waitFor(() => expect(window.location.pathname).toBe(`/repo/${repoSlugFromId(workspaceId)}/dashboard`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('dashboard'))
    expect(appMocks.render).not.toHaveBeenCalledWith('branch')
    expect(appMocks.render).not.toHaveBeenCalledWith('newWorktree')
  })

  test('keeps an explicitly selected workspace surface when Git capability becomes available', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/git-router-workspace')
    seedRepoCapability(workspaceId, 'available')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(`/repo/${repoSlugFromId(workspaceId)}/workspace`)

    await waitFor(() => expect(window.location.pathname).toBe(`/repo/${repoSlugFromId(workspaceId)}/workspace`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
    expect(appMocks.render).not.toHaveBeenCalledWith('dashboard')
  })
})

function seedRepoCapability(workspaceId: WorkspaceId, gitStatus: 'available' | 'unavailable') {
  resetWorkspacesStore()
  const repo = emptyWorkspace(workspaceId, 'workspace', 'runtime-router-test')
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
    workspaces: { [workspaceId]: repo },
    workspaceOrder: [workspaceId],
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
      workspaceRouteContextFromMatches([
        { routeId: '/repo/$repoSlug/branch/$branchSlug', params: { repoSlug: 'L3JlcG8', branchSlug: '%' } },
      ]),
    ).toEqual({ kind: 'empty', workspaceSlug: 'L3JlcG8' })
  })
})

describe('primary window route callback facades', () => {
  test('router and Layout callbacks delegate every primary write to arbiter-aware route actions', () => {
    const routeActions = {
      openHome: vi.fn(),
      openSettings: vi.fn(),
      closeSettings: vi.fn(),
      openWorkspaceNavigator: vi.fn(),
      openWorkspaceDashboard: vi.fn(),
      openWorkspaceRootPane: vi.fn(),
      openRepoBranch: vi.fn(() => true),
      openRepoBranchTab: vi.fn(() => true),
      openRepoBranchTerminal: vi.fn(() => true),
      openRepoNewWorktree: vi.fn(),
      cancelRepoNewWorktree: vi.fn(),
      workspaceSlugForId: vi.fn(),
    } as unknown as PrimaryWindowRouteNavigation
    const routerCallbacks = primaryWindowRouterCallbacks(routeActions)
    const layoutCallbacks = primaryWindowLayoutRouteCallbacks(routeActions)

    routerCallbacks.onRouteSettingsPageChange('general')
    routerCallbacks.onOpenWorkspaceNavigator(ROUTE_WORKSPACE_ID)
    routerCallbacks.onOpenWorkspaceDashboard(ROUTE_WORKSPACE_ID)
    routerCallbacks.onOpenRepoBranch(ROUTE_WORKSPACE_ID, 'main')
    routerCallbacks.onOpenRepoNewWorktree(ROUTE_WORKSPACE_ID)
    routerCallbacks.onCancelRepoNewWorktree(ROUTE_WORKSPACE_ID)
    routerCallbacks.onReplaceRepoBranch(ROUTE_WORKSPACE_ID, 'main')
    applyPrimaryWindowSettingsRouteChange(routeActions, null)
    layoutCallbacks.navigateToSettingsShortcuts()
    layoutCallbacks.navigateToIndex()

    expect(routeActions.openSettings).toHaveBeenNthCalledWith(1, 'general')
    expect(routeActions.openSettings).toHaveBeenNthCalledWith(2, 'shortcuts')
    expect(routeActions.closeSettings).toHaveBeenCalledOnce()
    expect(routeActions.openWorkspaceNavigator).toHaveBeenCalledWith(ROUTE_WORKSPACE_ID)
    expect(routeActions.openWorkspaceDashboard).toHaveBeenCalledWith(ROUTE_WORKSPACE_ID)
    expect(routeActions.openRepoNewWorktree).toHaveBeenCalledWith(ROUTE_WORKSPACE_ID)
    expect(routeActions.cancelRepoNewWorktree).toHaveBeenCalledWith(ROUTE_WORKSPACE_ID)
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
