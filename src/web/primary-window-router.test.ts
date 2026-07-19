// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement, Fragment, type ReactNode } from 'react'
import { Outlet } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const appMocks = vi.hoisted(() => ({ render: vi.fn() }))

vi.mock('#/web/App.tsx', () => ({
  App: (props: {
    routeWorkspaceView?: { kind: string; workspaceId: WorkspaceId } | null
    onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  }) => {
    appMocks.render(props.routeWorkspaceView?.kind ?? null)
    return createElement(
      'div',
      { 'data-testid': 'routed-app' },
      props.routeWorkspaceView?.kind ?? 'none',
      props.routeWorkspaceView?.kind === 'newWorktree'
        ? createElement(
            'button',
            {
              type: 'button',
              onClick: () => props.onCancelRepoNewWorktree?.(props.routeWorkspaceView!.workspaceId),
            },
            'cancel new worktree',
          )
        : null,
    )
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
import { workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
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

const WORKSPACE_A_ID = workspaceIdForTest('goblin+file:///workspace-a')
const WORKSPACE_B_ID = workspaceIdForTest('goblin+file:///workspace-b')
const MISSING_WORKSPACE_ID = workspaceIdForTest('goblin+file:///missing')
const GIT_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/repo')
const ROUTE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///route-workspace')
const DEEP_LINK_WORKSPACE_ID = workspaceIdForTest('goblin+file:///deep-link-workspace')

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  navigateBrowser('/')
  appMocks.render.mockClear()
  vi.restoreAllMocks()
})

describe('primary window initial route', () => {
  test('prefers the restored workspace over the first workspace in order', () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-a', 'workspace-runtime-a')
    const workspaceB = emptyWorkspace(WORKSPACE_B_ID, 'workspace-b', 'workspace-runtime-b')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: WORKSPACE_B_ID,
        workspaceOrder: [WORKSPACE_A_ID, WORKSPACE_B_ID],
        workspaces: { [WORKSPACE_A_ID]: workspaceA, [WORKSPACE_B_ID]: workspaceB },
        workspaceMembershipReady: true,
      }),
    ).toBe(workspaceSlugFromId(WORKSPACE_B_ID))
  })

  test('waits for workspace membership restore instead of routing to the first partial workspace', () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-a', 'workspace-runtime-a')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: null,
        workspaceOrder: [WORKSPACE_A_ID],
        workspaces: { [WORKSPACE_A_ID]: workspaceA },
        workspaceMembershipReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered workspace when restore has settled without a restored workspace', () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-a', 'workspace-runtime-a')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: MISSING_WORKSPACE_ID,
        workspaceOrder: [WORKSPACE_A_ID],
        workspaces: { [WORKSPACE_A_ID]: workspaceA },
        workspaceMembershipReady: true,
      }),
    ).toBe(workspaceSlugFromId(WORKSPACE_A_ID))
  })
})

describe('workspace route view derivation', () => {
  test('derives a routed workspace view directly from the URL slug without store hydration', () => {
    const workspaceSlug = workspaceSlugFromId(DEEP_LINK_WORKSPACE_ID)

    expect(
      workspaceRouteViewFromSlugChildRoute(workspaceSlug, { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'dashboard',
      workspaceId: DEEP_LINK_WORKSPACE_ID,
    })
  })

  test('returns null only when the workspace URL slug itself is invalid', () => {
    expect(
      workspaceRouteViewFromSlugChildRoute('%', { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toBeNull()
  })

  test('uses the workspace root as an empty route view', () => {
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'empty',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
  })

  test('maps child routes to stable workspace route views', () => {
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toEqual({
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
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: null, newWorktree: true }),
    ).toEqual({
      kind: 'newWorktree',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        branchSlug: 'ZmVhdHVyZS9h',
        newWorktree: false,
      }),
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
      workspaceRouteViewFromChildRoute(GIT_WORKSPACE_ID, {
        dashboard: false,
        branchSlug: null,
        worktreeSlug: worktreeSlugFromPath('/workspace/detached'),
        worktreeTerminalSessionId: 'term-333333333333333333333',
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'worktree',
      workspaceId: GIT_WORKSPACE_ID,
      worktreePath: '/workspace/detached',
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-333333333333333333333' },
    })
  })
})

describe('workspace route capability admission', () => {
  test.each([
    ['branch surface', (workspaceSlug: string) => `/workspace/${workspaceSlug}/branch/bWFpbg`],
    [
      'worktree surface',
      (workspaceSlug: string) =>
        `/workspace/${workspaceSlug}/worktree/${worktreeSlugFromPath('/tmp/plain-router-worktree')}`,
    ],
    ['new-worktree surface', (workspaceSlug: string) => `/workspace/${workspaceSlug}/worktree/new`],
  ])('redirects a non-Git %s to Dashboard without mounting the rejected surface', async (_label, pathForSlug) => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-router-workspace')
    seedWorkspaceCapability(workspaceId, 'unavailable')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(pathForSlug(workspaceSlugFromId(workspaceId)))

    await waitFor(() =>
      expect(window.location.pathname).toBe(`/workspace/${workspaceSlugFromId(workspaceId)}/dashboard`),
    )
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('dashboard'))
    expect(appMocks.render).not.toHaveBeenCalledWith('branch')
    expect(appMocks.render).not.toHaveBeenCalledWith('worktree')
    expect(appMocks.render).not.toHaveBeenCalledWith('newWorktree')
  })

  test('resolves a workspace root deep link before the router mounts', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/cold-workspace')
    seedWorkspaceCapability(workspaceId, 'unavailable')
    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/root`)

    render(createElement(PrimaryWindowRouterProvider))

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
  })

  test('resolves a Git worktree terminal deep link before the router mounts', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/cold-git-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    const worktreeSlug = worktreeSlugFromPath('/tmp/cold-git-worktree')
    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/worktree/${worktreeSlug}/terminal/terminal-test`)

    render(createElement(PrimaryWindowRouterProvider))

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('worktree'))
  })

  test('returns from new-worktree to the originating workspace route through the real router', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/return-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    const workspaceSlug = workspaceSlugFromId(workspaceId)
    const returnTo = `/workspace/${workspaceSlug}/branch/bWFpbg/tab/status`
    navigateBrowser(`/workspace/${workspaceSlug}/worktree/new?returnTo=${encodeURIComponent(returnTo)}`)
    const view = render(createElement(PrimaryWindowRouterProvider))

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('newWorktree'))
    fireEvent.click(view.getByRole('button', { name: 'cancel new worktree' }))

    await waitFor(() => expect(window.location.pathname).toBe(returnTo))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('branch'))
  })

  test('keeps an explicitly selected workspace surface when Git capability becomes available', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/git-router-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    render(createElement(PrimaryWindowRouterProvider))
    appMocks.render.mockClear()

    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/root`)

    await waitFor(() => expect(window.location.pathname).toBe(`/workspace/${workspaceSlugFromId(workspaceId)}/root`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
    expect(appMocks.render).not.toHaveBeenCalledWith('dashboard')
  })
})

function seedWorkspaceCapability(workspaceId: WorkspaceId, gitStatus: 'available' | 'unavailable') {
  resetWorkspacesStore()
  const workspace = emptyWorkspace(workspaceId, 'workspace', 'runtime-router-test')
  acceptWorkspaceProbeState(workspace, {
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
    workspaces: { [workspaceId]: workspace },
    workspaceOrder: [workspaceId],
    workspaceMembershipReady: true,
  })
}

function navigateBrowser(pathname: string) {
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

describe('workspace route context derivation', () => {
  test('keeps workspace context when a branch slug is malformed', () => {
    expect(
      workspaceRouteContextFromMatches([
        {
          routeId: '/workspace/$workspaceSlug/branch/$branchSlug',
          params: { workspaceSlug: 'L3JlcG8', branchSlug: '%' },
        },
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
