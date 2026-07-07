import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  redirect,
  useMatch,
} from '@tanstack/react-router'
import { App, type RepoRouteView } from '#/web/App.tsx'
import { Layout, WorkspaceSessionRestoreGate } from '#/web/Layout.tsx'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { branchNameFromSlug, repoIdFromSlug, repoSlugFromId } from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { ReposStore } from '#/web/stores/repos/types.ts'
import { usePrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

const rootRoute = createRootRoute()

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: Layout,
})

const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: IndexRoute,
})

const repoRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/repo/$repoSlug',
  component: RepoRoute,
})

const repoDashboardRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: 'dashboard',
})

const repoBranchRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: 'branch/$branchSlug',
})

const repoBranchIndexRoute = createRoute({
  getParentRoute: () => repoBranchRoute,
  path: '/',
})

const repoBranchTabRoute = createRoute({
  getParentRoute: () => repoBranchRoute,
  path: 'tab/$tabKey',
})

const repoBranchTerminalRoute = createRoute({
  getParentRoute: () => repoBranchRoute,
  path: 'terminal/$terminalSessionId',
})

const repoWorktreeNewRoute = createRoute({
  getParentRoute: () => repoRoute,
  path: 'worktree/new',
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' })
  },
})

const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings/$page',
  component: SettingsRoute,
  beforeLoad: ({ params }) => {
    if (!isSettingsPage(params.page)) {
      throw redirect({ to: '/settings/general' })
    }
  },
})

function IndexRoute() {
  const firstRepoSlug = useReposStore(initialRepoRouteSlugFromStore)
  const navigation = useRepoRouteNavigation()
  if (firstRepoSlug) return <Navigate to="/repo/$repoSlug/dashboard" params={{ repoSlug: firstRepoSlug }} replace />
  return (
    <WorkspaceSessionRestoreGate>
      <App routeSettingsPage={null} {...navigation} />
    </WorkspaceSessionRestoreGate>
  )
}

export function initialRepoRouteSlugFromStore(
  state: Pick<ReposStore, 'restoredRepoId' | 'order' | 'repos' | 'workspaceMembershipReady'>,
): string | null {
  const restoredRepo = state.restoredRepoId ? state.repos[state.restoredRepoId] : null
  if (restoredRepo) return repoSlugFromId(restoredRepo.id)
  if (!state.workspaceMembershipReady) return null
  const firstRepoId = state.order[0]
  const firstRepo = firstRepoId ? state.repos[firstRepoId] : null
  return firstRepo ? repoSlugFromId(firstRepo.id) : null
}

function RepoRoute() {
  const { repoSlug } = repoRoute.useParams()
  const dashboardMatch = useMatch({ from: repoDashboardRoute.id, shouldThrow: false })
  const branchMatch = useMatch({ from: repoBranchRoute.id, shouldThrow: false })
  const branchTabMatch = useMatch({ from: repoBranchTabRoute.id, shouldThrow: false })
  const branchTerminalMatch = useMatch({ from: repoBranchTerminalRoute.id, shouldThrow: false })
  const newWorktreeMatch = useMatch({ from: repoWorktreeNewRoute.id, shouldThrow: false })
  const navigation = useRepoRouteNavigation()
  const routeRepoView = repoRouteViewFromSlugChildRoute(repoSlug, {
    dashboard: !!dashboardMatch,
    branchSlug: branchMatch?.params.branchSlug ?? null,
    tabKey: branchTabMatch?.params.tabKey ?? null,
    terminalSessionId: branchTerminalMatch?.params.terminalSessionId ?? null,
    newWorktree: !!newWorktreeMatch,
  })
  return (
    <WorkspaceSessionRestoreGate>
      <App routeRepoView={routeRepoView} {...navigation} />
    </WorkspaceSessionRestoreGate>
  )
}

export function repoRouteViewFromSlugChildRoute(
  repoSlug: string,
  childRoute: {
    dashboard: boolean
    branchSlug: string | null
    tabKey?: string | null
    terminalSessionId?: string | null
    newWorktree: boolean
  },
): RepoRouteView | null {
  const repoId = repoIdFromSlug(repoSlug)
  return repoId ? repoRouteViewFromChildRoute(repoId, childRoute) : null
}

export function repoRouteViewFromChildRoute(
  repoId: string,
  childRoute: {
    dashboard: boolean
    branchSlug: string | null
    tabKey?: string | null
    terminalSessionId?: string | null
    newWorktree: boolean
  },
): RepoRouteView {
  if (childRoute.branchSlug) {
    const branchName = branchNameFromSlug(childRoute.branchSlug)
    if (!branchName) return { kind: 'empty', repoId }
    if (childRoute.terminalSessionId) {
      return {
        kind: 'branch',
        repoId,
        branchName,
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: childRoute.terminalSessionId },
      }
    }
    if (childRoute.tabKey) {
      return {
        kind: 'branch',
        repoId,
        branchName,
        workspacePaneRoute: isWorkspacePaneStaticTabType(childRoute.tabKey)
          ? { kind: 'static', tab: childRoute.tabKey }
          : { kind: 'invalid-static', tabKey: childRoute.tabKey },
      }
    }
    return { kind: 'branch', repoId, branchName, workspacePaneRoute: null }
  }
  if (childRoute.newWorktree) return { kind: 'newWorktree', repoId }
  if (childRoute.dashboard) return { kind: 'dashboard', repoId }
  return { kind: 'empty', repoId }
}

function useRepoRouteNavigation() {
  const routeNavigation = usePrimaryWindowRouteNavigation()
  return {
    onRouteSettingsPageChange: (page: SettingsPage | null) => {
      if (page) routeNavigation.openSettings(page)
    },
    onOpenRepoRoot: (repoId: string) => routeNavigation.openRepoRoot(repoId),
    onOpenRepoDashboard: (repoId: string) => routeNavigation.openRepoDashboard(repoId),
    onOpenRepoBranch: (repoId: string, branchName: string) => routeNavigation.openRepoBranch(repoId, branchName),
    onOpenRepoNewWorktree: (repoId: string) => routeNavigation.openRepoNewWorktree(repoId),
    onCancelRepoNewWorktree: (repoId: string) => routeNavigation.cancelRepoNewWorktree(repoId),
    onReplaceRepoBranch: (repoId: string, branchName: string) =>
      routeNavigation.openRepoBranch(repoId, branchName, { replace: true }),
  }
}

function SettingsRoute() {
  const { page } = settingsRoute.useParams()
  const routeNavigation = usePrimaryWindowRouteNavigation()
  return (
    <App
      routeSettingsPage={page as SettingsPage}
      onRouteSettingsPageChange={(nextPage) => {
        if (nextPage) routeNavigation.openSettings(nextPage)
        else routeNavigation.closeSettings()
      }}
    />
  )
}

const primaryWindowRouteTree = rootRoute.addChildren([
  layoutRoute.addChildren([
    indexRoute,
    repoRoute.addChildren([
      repoDashboardRoute,
      repoBranchRoute.addChildren([repoBranchIndexRoute, repoBranchTabRoute, repoBranchTerminalRoute]),
      repoWorktreeNewRoute,
    ]),
    settingsIndexRoute,
    settingsRoute,
  ]),
])

const primaryWindowRouter = createRouter({
  routeTree: primaryWindowRouteTree,
  history: createBrowserHistory(),
})

export function PrimaryWindowRouterProvider() {
  return <RouterProvider router={primaryWindowRouter} />
}
