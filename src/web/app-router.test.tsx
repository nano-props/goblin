// @vitest-environment jsdom

import { fireEvent, waitFor } from '@testing-library/vue'
import { defineComponent, onMounted, onUnmounted } from 'vue'
import type { PropType } from 'vue'
import { RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const appMocks = vi.hoisted(() => ({ render: vi.fn(), layoutMounted: vi.fn(), layoutUnmounted: vi.fn() }))

vi.mock('#/web/App.tsx', () => ({
  App: defineComponent({
    name: 'AppMock',
    inheritAttrs: false,
    props: {
      routeWorkspaceView: Object as PropType<{ kind: string; workspaceId: WorkspaceId } | null>,
      onCancelRepoNewWorktree: Function as PropType<(workspaceId: WorkspaceId) => void>,
    },
    setup(props) {
      return () => {
        const routeWorkspaceView = props.routeWorkspaceView
        appMocks.render(routeWorkspaceView?.kind ?? null)
        return (
          <div data-testid="routed-app">
            {routeWorkspaceView?.kind ?? 'none'}
            {routeWorkspaceView?.kind === 'newWorktree' ? (
              <button type="button" onClick={() => props.onCancelRepoNewWorktree?.(routeWorkspaceView.workspaceId)}>
                cancel new worktree
              </button>
            ) : null}
          </div>
        )
      }
    },
  }),
}))

vi.mock('#/web/Layout.tsx', () => ({
  Layout: defineComponent({
    name: 'LayoutMock',
    inheritAttrs: false,
    setup() {
      useAppHistoryPresentationObserver()
      onMounted(() => appMocks.layoutMounted())
      onUnmounted(() => appMocks.layoutUnmounted())
      return () => <RouterView />
    },
  }),
}))
import {
  initialWorkspaceRouteSlugFromStore,
  workspaceRouteViewFromChildRoute,
  workspaceRouteViewFromSlugChildRoute,
  appRouterCallbacks,
  applyAppSettingsRouteChange,
  AppRouterProvider,
  appRouter,
} from '#/web/app-router.tsx'
import { workspaceSlugFromId, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import {
  authenticatedAppShellMode,
  currentWorkspacePaneRouteFromContext,
  appLayoutRouteCallbacks,
  workspaceRouteContextFromMatches,
} from '#/web/app-layout-model.ts'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import { requireAppHistoryPresentation, useAppHistoryPresentationObserver } from '#/web/app-history-presentation.ts'
import {
  beginAppNavigation,
  observeAppHistoryNavigation,
  appNavigationIsCurrent,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import type { AuthenticatedAppBootstrapState } from '#/web/hooks/useAuthenticatedAppBootstrap.ts'
import { resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const WORKSPACE_A_ID = workspaceIdForTest('goblin+file:///workspace-a')
const WORKSPACE_B_ID = workspaceIdForTest('goblin+file:///workspace-b')
const MISSING_WORKSPACE_ID = workspaceIdForTest('goblin+file:///missing')
const GIT_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/repo')
const ROUTE_WORKSPACE_ID = workspaceIdForTest('goblin+file:///route-workspace')
const DEEP_LINK_WORKSPACE_ID = workspaceIdForTest('goblin+file:///deep-link-workspace')

beforeEach(async () => {
  navigateBrowser('/')
  await vi.waitFor(() => expect(appRouter.currentRoute.value.fullPath).toBe('/'))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  appMocks.render.mockClear()
  appMocks.layoutMounted.mockClear()
  appMocks.layoutUnmounted.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('app initial route', () => {
  test('prefers the restored workspace over the first workspace in order', async () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-runtime-a')
    const workspaceB = emptyWorkspace(WORKSPACE_B_ID, 'workspace-runtime-b')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: WORKSPACE_B_ID,
        workspaceOrder: [WORKSPACE_A_ID, WORKSPACE_B_ID],
        workspaces: { [WORKSPACE_A_ID]: workspaceA, [WORKSPACE_B_ID]: workspaceB },
        workspaceMembershipReady: true,
      }),
    ).toBe(workspaceSlugFromId(WORKSPACE_B_ID))
  })

  test('waits for workspace membership restore instead of routing to the first partial workspace', async () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-runtime-a')

    expect(
      initialWorkspaceRouteSlugFromStore({
        restoredWorkspaceId: null,
        workspaceOrder: [WORKSPACE_A_ID],
        workspaces: { [WORKSPACE_A_ID]: workspaceA },
        workspaceMembershipReady: false,
      }),
    ).toBeNull()
  })

  test('falls back to the first ordered workspace when restore has settled without a restored workspace', async () => {
    const workspaceA = emptyWorkspace(WORKSPACE_A_ID, 'workspace-runtime-a')

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

describe('unmatched app routes', () => {
  test.each(['/unknown', `/workspace/${workspaceSlugFromId(WORKSPACE_A_ID)}/unknown-child`])(
    'renders an explicit not-found surface for %s',
    async (path) => {
      navigateBrowser(path)

      const view = renderRouter()

      await waitFor(() => expect(appRouter.currentRoute.value.name).toBe('not-found'))
      expect(view.container.textContent).toContain('route.not-found-title')
    },
  )

  test('keeps the root Layout owner mounted while navigating through an unmatched route', async () => {
    navigateBrowser('/settings/general')
    renderRouter()
    await waitFor(() => expect(appRouter.currentRoute.value.name).toBe('settings'))
    expect(appMocks.layoutMounted).toHaveBeenCalledTimes(1)

    await appRouter.push('/unknown')
    await waitFor(() => expect(appRouter.currentRoute.value.name).toBe('not-found'))
    expect(requireAppHistoryPresentation(appRouter.options.history).action).toEqual({ type: 'PUSH' })
    expect(appMocks.layoutMounted).toHaveBeenCalledTimes(1)
    expect(appMocks.layoutUnmounted).not.toHaveBeenCalled()

    appRouter.back()
    await waitFor(() => expect(appRouter.currentRoute.value.fullPath).toBe('/settings/general'))
    expect(requireAppHistoryPresentation(appRouter.options.history).action).toEqual({ type: 'BACK' })
    expect(appMocks.layoutMounted).toHaveBeenCalledTimes(1)
    expect(appMocks.layoutUnmounted).not.toHaveBeenCalled()
  })
})

describe('workspace route view derivation', () => {
  test('derives a routed workspace view directly from the URL slug without store hydration', async () => {
    const workspaceSlug = workspaceSlugFromId(DEEP_LINK_WORKSPACE_ID)

    expect(
      workspaceRouteViewFromSlugChildRoute(workspaceSlug, { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'dashboard',
      workspaceId: DEEP_LINK_WORKSPACE_ID,
    })
  })

  test('returns null only when the workspace URL slug itself is invalid', async () => {
    expect(
      workspaceRouteViewFromSlugChildRoute('%', { dashboard: true, branchSlug: null, newWorktree: false }),
    ).toBeNull()
  })

  test('uses the workspace root as an empty route view', async () => {
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, { dashboard: false, branchSlug: null, newWorktree: false }),
    ).toEqual({
      kind: 'empty',
      workspaceId: ROUTE_WORKSPACE_ID,
    })
  })

  test('maps child routes to stable workspace route views', async () => {
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
    ).toEqual({ kind: 'workspace-root', workspaceId: ROUTE_WORKSPACE_ID, workspacePaneRoute: null })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        workspace: true,
        workspaceTabKey: 'files',
        branchSlug: null,
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'workspace-root',
      workspaceId: ROUTE_WORKSPACE_ID,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
    })
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        workspace: true,
        workspaceTerminalSessionId: 'term-111111111111111111111',
        branchSlug: null,
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'workspace-root',
      workspaceId: ROUTE_WORKSPACE_ID,
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
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

  test('maps branch workspace pane child routes to stable route views', async () => {
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

  test('prefers a terminal child route when terminal and static params are both present', async () => {
    expect(
      workspaceRouteViewFromChildRoute(ROUTE_WORKSPACE_ID, {
        dashboard: false,
        workspace: true,
        workspaceTabKey: 'files',
        workspaceTerminalSessionId: 'term-111111111111111111111',
        branchSlug: null,
        newWorktree: false,
      }),
    ).toEqual({
      kind: 'workspace-root',
      workspaceId: ROUTE_WORKSPACE_ID,
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
    })
  })

  test('maps a detached worktree terminal URL to a filesystem surface', async () => {
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
    renderRouter()
    appMocks.render.mockClear()

    navigateBrowser(pathForSlug(workspaceSlugFromId(workspaceId)))

    await waitFor(() =>
      expect(window.location.pathname).toBe(`/workspace/${workspaceSlugFromId(workspaceId)}/dashboard`),
    )
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('dashboard'))
    expect(requireAppHistoryPresentation(appRouter.options.history).action).toEqual({ type: 'REPLACE' })
    expect(appMocks.render).not.toHaveBeenCalledWith('branch')
    expect(appMocks.render).not.toHaveBeenCalledWith('worktree')
    expect(appMocks.render).not.toHaveBeenCalledWith('newWorktree')
  })

  test('resolves a workspace root deep link before the router mounts', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/cold-workspace')
    seedWorkspaceCapability(workspaceId, 'unavailable')
    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/root`)

    renderRouter()

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
  })

  test('resolves a Git worktree terminal deep link before the router mounts', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/cold-git-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    const worktreeSlug = worktreeSlugFromPath('/tmp/cold-git-worktree')
    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/worktree/${worktreeSlug}/terminal/terminal-test`)

    renderRouter()

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('worktree'))
  })

  test('returns from new-worktree to the originating workspace route through the real router', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/return-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    const workspaceSlug = workspaceSlugFromId(workspaceId)
    const returnTo = `/workspace/${workspaceSlug}/branch/bWFpbg/tab/status`
    navigateBrowser(`/workspace/${workspaceSlug}/worktree/new?returnTo=${encodeURIComponent(returnTo)}`)
    const view = renderRouter()

    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('newWorktree'))
    await fireEvent.click(view.getByRole('button', { name: 'cancel new worktree' }))

    await waitFor(() => expect(window.location.pathname).toBe(returnTo))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('branch'))
  })

  test('keeps an explicitly selected workspace surface when Git capability becomes available', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/git-router-workspace')
    seedWorkspaceCapability(workspaceId, 'available')
    renderRouter()
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('dashboard'))
    appMocks.render.mockClear()

    navigateBrowser(`/workspace/${workspaceSlugFromId(workspaceId)}/root`)

    await waitFor(() => expect(window.location.pathname).toBe(`/workspace/${workspaceSlugFromId(workspaceId)}/root`))
    await waitFor(() => expect(appMocks.render).toHaveBeenCalledWith('workspace-root'))
    expect(appMocks.render).not.toHaveBeenCalledWith('dashboard')
  })
})

function seedWorkspaceCapability(workspaceId: WorkspaceId, gitStatus: 'available' | 'unavailable') {
  resetWorkspacesStore()
  const workspace = emptyWorkspace(workspaceId, 'runtime-router-test')
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
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
  workspacesStore.setState({
    workspaces: { [workspaceId]: workspace },
    workspaceOrder: [workspaceId],
    workspaceMembershipReady: true,
  })
}

function navigateBrowser(pathname: string) {
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function renderRouter() {
  return renderInJsdom(AppRouterProvider, { global: { plugins: [appRouter] } })
}

describe('workspace route context derivation', () => {
  test('preserves the active pane route for a detached worktree context', async () => {
    const workspacePaneRoute = { kind: 'terminal' as const, terminalSessionId: 'term-111111111111111111111' }

    expect(
      currentWorkspacePaneRouteFromContext({
        kind: 'worktree',
        workspaceSlug: 'L3JlcG8',
        worktreePath: '/tmp/detached-worktree',
        workspacePaneRoute,
      }),
    ).toEqual(workspacePaneRoute)
  })

  test('keeps workspace context when a branch slug is malformed', async () => {
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

describe('app route callback facades', () => {
  test('router and Layout callbacks delegate every primary write to arbiter-aware route actions', async () => {
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
    } as unknown as AppRouteNavigation
    const routerCallbacks = appRouterCallbacks(routeActions)
    const layoutCallbacks = appLayoutRouteCallbacks(routeActions)

    routerCallbacks.onRouteSettingsPageChange('general')
    routerCallbacks.onOpenWorkspaceNavigator(ROUTE_WORKSPACE_ID)
    routerCallbacks.onOpenWorkspaceDashboard(ROUTE_WORKSPACE_ID)
    routerCallbacks.onOpenRepoBranch(ROUTE_WORKSPACE_ID, 'main')
    routerCallbacks.onOpenRepoNewWorktree(ROUTE_WORKSPACE_ID)
    routerCallbacks.onCancelRepoNewWorktree(ROUTE_WORKSPACE_ID)
    routerCallbacks.onReplaceRepoBranch(ROUTE_WORKSPACE_ID, 'main', 1)
    applyAppSettingsRouteChange(routeActions, null)
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

  test('created worktree replacement commits its accepted branch route without snapshot admission', async () => {
    const routeActions = {
      openRepoBranch: vi.fn(() => true),
    } as unknown as AppRouteNavigation

    appRouterCallbacks(routeActions).onReplaceRepoBranch(ROUTE_WORKSPACE_ID, 'feature/new', 7)

    expect(routeActions.openRepoBranch).toHaveBeenCalledWith(ROUTE_WORKSPACE_ID, 'feature/new', {
      replace: true,
      navigationGeneration: 7,
    })
  })

  test.each([
    ['/settings/general', { status: 'ready' as const }],
    ['/', { status: 'restoring-workspace' as const }],
  ])('browser traversal supersedes independently of conditional shell mode at %s', (pathname, bootstrapState) => {
    resetAppNavigationForTest()
    authenticatedAppShellMode(pathname, bootstrapState as AuthenticatedAppBootstrapState)
    const generation = beginAppNavigation()

    observeAppHistoryNavigation({ href: '/', state: {}, action: { type: 'BACK' } })

    expect(appNavigationIsCurrent(generation)).toBe(false)
  })
})
