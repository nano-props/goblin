import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  redirect,
} from '@tanstack/react-router'
import { App } from '#/web/App.tsx'
import { AuthenticatedWorkspaceBootGate, Layout } from '#/web/Layout.tsx'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import {
  branchNameFromSlug,
  repoIdFromSlug,
  repoSlugFromId,
} from '#/web/repo-route-slugs.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { ReposStore } from '#/web/stores/repos/types.ts'
import { usePrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'

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

const repoDashboardRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/repo/$repoSlug/dashboard',
  component: RepoDashboardRoute,
})

const repoBranchRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/repo/$repoSlug/branch/$branchSlug',
  component: RepoBranchRoute,
})

const repoWorktreeNewRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/repo/$repoSlug/worktree/new',
  component: RepoWorktreeNewRoute,
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
    <AuthenticatedWorkspaceBootGate>
      <App routeSettingsPage={null} {...navigation} />
    </AuthenticatedWorkspaceBootGate>
  )
}

export function initialRepoRouteSlugFromStore(
  state: Pick<ReposStore, 'restoredRepoId' | 'order' | 'repos' | 'sessionReady'>,
): string | null {
  const restoredRepo = state.restoredRepoId ? state.repos[state.restoredRepoId] : null
  if (restoredRepo) return repoSlugFromId(restoredRepo.id)
  if (!state.sessionReady) return null
  const firstRepoId = state.order[0]
  const firstRepo = firstRepoId ? state.repos[firstRepoId] : null
  return firstRepo ? repoSlugFromId(firstRepo.id) : null
}

function RepoDashboardRoute() {
  const { repoSlug } = repoDashboardRoute.useParams()
  const repoId = useRepoIdFromSlug(repoSlug)
  const navigation = useRepoRouteNavigation()
  return (
    <AuthenticatedWorkspaceBootGate>
      <App routeRepoView={repoId ? { kind: 'dashboard', repoId } : null} {...navigation} />
    </AuthenticatedWorkspaceBootGate>
  )
}

function RepoBranchRoute() {
  const { repoSlug, branchSlug } = repoBranchRoute.useParams()
  const repoId = useRepoIdFromSlug(repoSlug)
  const branchName = branchNameFromSlug(branchSlug)
  const navigation = useRepoRouteNavigation()
  return (
    <AuthenticatedWorkspaceBootGate>
      <App routeRepoView={repoId && branchName ? { kind: 'branch', repoId, branchName } : null} {...navigation} />
    </AuthenticatedWorkspaceBootGate>
  )
}

function RepoWorktreeNewRoute() {
  const { repoSlug } = repoWorktreeNewRoute.useParams()
  const repoId = useRepoIdFromSlug(repoSlug)
  const navigation = useRepoRouteNavigation()
  return (
    <AuthenticatedWorkspaceBootGate>
      <App routeRepoView={repoId ? { kind: 'newWorktree', repoId } : null} {...navigation} />
    </AuthenticatedWorkspaceBootGate>
  )
}

function useRepoRouteNavigation() {
  const routeNavigation = usePrimaryWindowRouteNavigation()
  return {
    onRouteSettingsPageChange: (page: SettingsPage | null) => {
      if (page) routeNavigation.openSettings(page)
    },
    onOpenRepoDashboard: (repoId: string) => routeNavigation.openRepoDashboard(repoId),
    onOpenRepoBranch: (repoId: string, branchName: string) => routeNavigation.openRepoBranch(repoId, branchName),
    onOpenRepoNewWorktree: (repoId: string) => routeNavigation.openRepoNewWorktree(repoId),
    onCancelRepoNewWorktree: (repoId: string) => routeNavigation.cancelRepoNewWorktree(repoId),
    onReplaceRepoBranch: (repoId: string, branchName: string) => routeNavigation.openRepoBranch(repoId, branchName, { replace: true }),
  }
}

function useRepoIdFromSlug(repoSlug: string): string | null {
  const repoId = repoIdFromSlug(repoSlug)
  return useReposStore((s) => {
    if (!repoId) return null
    return s.repos[repoId]?.id ?? null
  })
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
    repoDashboardRoute,
    repoBranchRoute,
    repoWorktreeNewRoute,
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
