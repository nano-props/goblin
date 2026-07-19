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
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { App, type WorkspaceRouteView } from '#/web/App.tsx'
import { Layout, WorkspaceSessionRestoreGate } from '#/web/Layout.tsx'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import {
  branchNameFromSlug,
  workspaceIdFromSlug,
  workspaceSlugFromId,
  worktreePathFromSlug,
} from '#/web/workspace-route-slugs.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import {
  usePrimaryWindowRouteActions,
  type PrimaryWindowRouteNavigation,
} from '#/web/primary-window-route-navigation.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { openWorkspacePaneRoute } from '#/web/workspace-pane/repo-branch-workspace-pane-route.ts'

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

const workspaceRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/workspace/$workspaceSlug',
  component: WorkspaceRoute,
})

const workspaceDashboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'dashboard',
})

const workspaceRootRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'root',
})

const workspaceRootTabRoute = createRoute({
  getParentRoute: () => workspaceRootRoute,
  path: 'tab/$tabKey',
})

const workspaceRootTerminalRoute = createRoute({
  getParentRoute: () => workspaceRootRoute,
  path: 'terminal/$terminalSessionId',
})

const gitBranchRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'branch/$branchSlug',
})

const gitBranchIndexRoute = createRoute({
  getParentRoute: () => gitBranchRoute,
  path: '/',
})

const gitBranchTabRoute = createRoute({
  getParentRoute: () => gitBranchRoute,
  path: 'tab/$tabKey',
})

const gitBranchTerminalRoute = createRoute({
  getParentRoute: () => gitBranchRoute,
  path: 'terminal/$terminalSessionId',
})

const gitWorktreeNewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'worktree/new',
})

const gitWorktreeRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'worktree/$worktreeSlug',
})

const gitWorktreeTerminalRoute = createRoute({
  getParentRoute: () => gitWorktreeRoute,
  path: 'terminal/$terminalSessionId',
})

const gitWorktreeTabRoute = createRoute({
  getParentRoute: () => gitWorktreeRoute,
  path: 'tab/$tabKey',
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
  const firstWorkspaceSlug = useWorkspacesStore(initialWorkspaceRouteSlugFromStore)
  const navigation = useWorkspaceRouteNavigation()
  if (firstWorkspaceSlug) {
    return <Navigate to="/workspace/$workspaceSlug/dashboard" params={{ workspaceSlug: firstWorkspaceSlug }} replace />
  }
  return (
    <WorkspaceSessionRestoreGate>
      <App routeSettingsPage={null} {...navigation} />
    </WorkspaceSessionRestoreGate>
  )
}

export function initialWorkspaceRouteSlugFromStore(
  state: Pick<WorkspacesStore, 'restoredWorkspaceId' | 'workspaceOrder' | 'workspaces' | 'workspaceMembershipReady'>,
): string | null {
  const restoredWorkspace = state.restoredWorkspaceId ? state.workspaces[state.restoredWorkspaceId] : null
  if (restoredWorkspace) return workspaceSlugFromId(restoredWorkspace.id)
  if (!state.workspaceMembershipReady) return null
  const firstWorkspaceId = state.workspaceOrder[0]
  const firstWorkspace = firstWorkspaceId ? state.workspaces[firstWorkspaceId] : null
  return firstWorkspace ? workspaceSlugFromId(firstWorkspace.id) : null
}

function WorkspaceRoute() {
  const { workspaceSlug } = workspaceRoute.useParams()
  const dashboardMatch = useMatch({ from: workspaceDashboardRoute.id, shouldThrow: false })
  const workspaceMatch = useMatch({ from: workspaceRootRoute.id, shouldThrow: false })
  const workspaceTabMatch = useMatch({ from: workspaceRootTabRoute.id, shouldThrow: false })
  const workspaceTerminalMatch = useMatch({ from: workspaceRootTerminalRoute.id, shouldThrow: false })
  const branchMatch = useMatch({ from: gitBranchRoute.id, shouldThrow: false })
  const branchTabMatch = useMatch({ from: gitBranchTabRoute.id, shouldThrow: false })
  const branchTerminalMatch = useMatch({ from: gitBranchTerminalRoute.id, shouldThrow: false })
  const newWorktreeMatch = useMatch({ from: gitWorktreeNewRoute.id, shouldThrow: false })
  const worktreeMatch = useMatch({ from: gitWorktreeRoute.id, shouldThrow: false })
  const worktreeTerminalMatch = useMatch({ from: gitWorktreeTerminalRoute.id, shouldThrow: false })
  const worktreeTabMatch = useMatch({ from: gitWorktreeTabRoute.id, shouldThrow: false })
  const navigation = useWorkspaceRouteNavigation()
  const workspaceId = workspaceIdFromSlug(workspaceSlug)
  const gitUnavailable = useWorkspacesStore((state) => {
    const workspace = workspaceId ? state.workspaces[workspaceId] : null
    return workspace?.capability.kind === 'filesystem'
  })
  if (gitUnavailable && (branchMatch || worktreeMatch || newWorktreeMatch)) {
    return <Navigate to="/workspace/$workspaceSlug/dashboard" params={{ workspaceSlug }} replace />
  }
  const routeWorkspaceView = workspaceRouteViewFromSlugChildRoute(workspaceSlug, {
    dashboard: !!dashboardMatch,
    workspace: !!workspaceMatch,
    workspaceTabKey: workspaceTabMatch?.params.tabKey ?? null,
    workspaceTerminalSessionId: workspaceTerminalMatch?.params.terminalSessionId ?? null,
    branchSlug: branchMatch?.params.branchSlug ?? null,
    tabKey: branchTabMatch?.params.tabKey ?? null,
    terminalSessionId: branchTerminalMatch?.params.terminalSessionId ?? null,
    worktreeSlug: worktreeMatch?.params.worktreeSlug ?? null,
    worktreeTerminalSessionId: worktreeTerminalMatch?.params.terminalSessionId ?? null,
    worktreeTabKey: worktreeTabMatch?.params.tabKey ?? null,
    newWorktree: !!newWorktreeMatch,
  })
  return (
    <WorkspaceSessionRestoreGate>
      <App routeWorkspaceView={routeWorkspaceView} {...navigation} />
    </WorkspaceSessionRestoreGate>
  )
}

export function workspaceRouteViewFromSlugChildRoute(
  workspaceSlug: string,
  childRoute: {
    dashboard: boolean
    workspace?: boolean
    workspaceTabKey?: string | null
    workspaceTerminalSessionId?: string | null
    branchSlug: string | null
    tabKey?: string | null
    terminalSessionId?: string | null
    worktreeSlug?: string | null
    worktreeTerminalSessionId?: string | null
    worktreeTabKey?: string | null
    newWorktree: boolean
  },
): WorkspaceRouteView | null {
  const workspaceId = workspaceIdFromSlug(workspaceSlug)
  return workspaceId ? workspaceRouteViewFromChildRoute(workspaceId, childRoute) : null
}

export function workspaceRouteViewFromChildRoute(
  workspaceId: WorkspaceId,
  childRoute: {
    dashboard: boolean
    workspace?: boolean
    workspaceTabKey?: string | null
    workspaceTerminalSessionId?: string | null
    branchSlug: string | null
    tabKey?: string | null
    terminalSessionId?: string | null
    worktreeSlug?: string | null
    worktreeTerminalSessionId?: string | null
    worktreeTabKey?: string | null
    newWorktree: boolean
  },
): WorkspaceRouteView {
  if (childRoute.worktreeSlug) {
    const worktreePath = worktreePathFromSlug(childRoute.worktreeSlug)
    if (!worktreePath) return { kind: 'empty', workspaceId }
    return {
      kind: 'worktree',
      workspaceId,
      worktreePath,
      workspacePaneRoute: childRoute.worktreeTerminalSessionId
        ? { kind: 'terminal', terminalSessionId: childRoute.worktreeTerminalSessionId }
        : childRoute.worktreeTabKey
          ? isWorkspacePaneStaticTabType(childRoute.worktreeTabKey)
            ? { kind: 'static', tab: childRoute.worktreeTabKey }
            : { kind: 'invalid-static', tabKey: childRoute.worktreeTabKey }
          : null,
    }
  }
  if (childRoute.branchSlug) {
    const branchName = branchNameFromSlug(childRoute.branchSlug)
    if (!branchName) return { kind: 'empty', workspaceId }
    if (childRoute.terminalSessionId) {
      return {
        kind: 'branch',
        workspaceId,
        branchName,
        workspacePaneRoute: { kind: 'terminal', terminalSessionId: childRoute.terminalSessionId },
      }
    }
    if (childRoute.tabKey) {
      return {
        kind: 'branch',
        workspaceId,
        branchName,
        workspacePaneRoute: isWorkspacePaneStaticTabType(childRoute.tabKey)
          ? { kind: 'static', tab: childRoute.tabKey }
          : { kind: 'invalid-static', tabKey: childRoute.tabKey },
      }
    }
    return { kind: 'branch', workspaceId, branchName, workspacePaneRoute: null }
  }
  if (childRoute.newWorktree) return { kind: 'newWorktree', workspaceId }
  if (childRoute.dashboard) return { kind: 'dashboard', workspaceId }
  if (childRoute.workspace) {
    return {
      kind: 'workspace-root',
      workspaceId,
      workspacePaneRoute: childRoute.workspaceTerminalSessionId
        ? { kind: 'terminal', terminalSessionId: childRoute.workspaceTerminalSessionId }
        : childRoute.workspaceTabKey
          ? isWorkspacePaneStaticTabType(childRoute.workspaceTabKey)
            ? { kind: 'static', tab: childRoute.workspaceTabKey }
            : { kind: 'invalid-static', tabKey: childRoute.workspaceTabKey }
          : null,
    }
  }
  return { kind: 'empty', workspaceId }
}

function useWorkspaceRouteNavigation() {
  const routeActions = usePrimaryWindowRouteActions()
  return primaryWindowRouterCallbacks(routeActions)
}

export function primaryWindowRouterCallbacks(routeActions: PrimaryWindowRouteNavigation) {
  return {
    onRouteSettingsPageChange: (page: SettingsPage | null) => {
      if (page) routeActions.openSettings(page)
    },
    onOpenWorkspaceNavigator: (workspaceId: WorkspaceId) => routeActions.openWorkspaceNavigator(workspaceId),
    onOpenWorkspaceRootPane: (workspaceId: WorkspaceId) => routeActions.openWorkspaceRootPane(workspaceId),
    onOpenWorkspaceDashboard: (workspaceId: WorkspaceId) => routeActions.openWorkspaceDashboard(workspaceId),
    onOpenRepoBranch: (workspaceId: WorkspaceId, branchName: string) =>
      openWorkspacePaneRoute(routeActions, workspaceId, branchName),
    onOpenRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.openRepoNewWorktree(workspaceId),
    onCancelRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.cancelRepoNewWorktree(workspaceId),
    onReplaceRepoBranch: (workspaceId: WorkspaceId, branchName: string) =>
      openWorkspacePaneRoute(routeActions, workspaceId, branchName, { replace: true }),
  }
}

export function applyPrimaryWindowSettingsRouteChange(
  routeActions: Pick<PrimaryWindowRouteNavigation, 'openSettings' | 'closeSettings'>,
  nextPage: SettingsPage | null,
): void {
  if (nextPage) routeActions.openSettings(nextPage)
  else routeActions.closeSettings()
}

function SettingsRoute() {
  const { page } = settingsRoute.useParams()
  const routeActions = usePrimaryWindowRouteActions()
  return (
    <App
      routeSettingsPage={page as SettingsPage}
      onRouteSettingsPageChange={(nextPage) => applyPrimaryWindowSettingsRouteChange(routeActions, nextPage)}
    />
  )
}

const primaryWindowRouteTree = rootRoute.addChildren([
  layoutRoute.addChildren([
    indexRoute,
    workspaceRoute.addChildren([
      workspaceDashboardRoute,
      workspaceRootRoute.addChildren([workspaceRootTabRoute, workspaceRootTerminalRoute]),
      gitBranchRoute.addChildren([gitBranchIndexRoute, gitBranchTabRoute, gitBranchTerminalRoute]),
      gitWorktreeRoute.addChildren([gitWorktreeTerminalRoute, gitWorktreeTabRoute]),
      gitWorktreeNewRoute,
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
