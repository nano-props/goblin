import { computed, defineComponent, watch } from 'vue'
import { createRouter, createWebHistory, RouterView, useRoute, useRouter } from 'vue-router'
import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { createAppHistoryPresentationHistory } from '#/web/app-history-presentation.ts'
import { App } from '#/web/App.tsx'
import type { ParsedBranchWorkspacePaneRouteTarget, ParsedWorkspacePaneRoute, WorkspaceRouteView } from '#/web/App.tsx'
import { Layout } from '#/web/Layout.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { useAppRouteNavigation } from '#/web/app-route-navigation.ts'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import {
  branchNameFromSlug,
  workspaceIdFromSlug,
  workspaceSlugFromId,
  worktreePathFromSlug,
} from '#/web/workspace-route-slugs.ts'
import type { RuntimeCoherentWorkspaceState } from '#/web/stores/workspaces/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

const AppRouteView = defineComponent({
  name: 'AppRouteView',
  setup() {
    const route = useRoute()
    useAppRouteAdmission(route)
    const callbacks = appRouterCallbacks(useAppRouteNavigation())
    return () => (
      <App
        routeSettingsPage={route.name === 'settings' ? settingsPageFromRoute(route) : null}
        routeWorkspaceView={workspaceRouteViewFromRoute(route)}
        {...callbacks}
      />
    )
  },
})

const AppNotFoundRouteView = defineComponent({
  name: 'AppNotFoundRouteView',
  setup() {
    const t = useT()
    return () => <EmptyState title={t('route.not-found-title')} />
  },
})

const appRouteChildren: RouteRecordRaw[] = [
  { path: '', name: 'home', component: AppRouteView },
  { path: 'settings', redirect: '/settings/general' },
  {
    path: 'settings/:page',
    name: 'settings',
    component: AppRouteView,
    beforeEnter: (to: RouteLocationNormalized) =>
      isSettingsPage(routeStringParam(to.params.page)) ? true : '/settings/general',
  },
  { path: 'workspace/:workspaceSlug', name: 'workspace', component: AppRouteView },
  { path: 'workspace/:workspaceSlug/dashboard', name: 'workspace-dashboard', component: AppRouteView },
  { path: 'workspace/:workspaceSlug/root', name: 'workspace-root', component: AppRouteView },
  { path: 'workspace/:workspaceSlug/root/tab/:tabKey', name: 'workspace-root-tab', component: AppRouteView },
  {
    path: 'workspace/:workspaceSlug/root/terminal/:terminalSessionId',
    name: 'workspace-root-terminal',
    component: AppRouteView,
  },
  { path: 'workspace/:workspaceSlug/branch/:branchSlug', name: 'workspace-branch', component: AppRouteView },
  {
    path: 'workspace/:workspaceSlug/branch/:branchSlug/tab/:tabKey',
    name: 'workspace-branch-tab',
    component: AppRouteView,
  },
  { path: 'workspace/:workspaceSlug/worktree/new', name: 'workspace-new-worktree', component: AppRouteView },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug',
    name: 'workspace-worktree',
    component: AppRouteView,
  },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug/tab/:tabKey',
    name: 'workspace-worktree-tab',
    component: AppRouteView,
  },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug/terminal/:terminalSessionId',
    name: 'workspace-worktree-terminal',
    component: AppRouteView,
  },
  { path: ':pathMatch(.*)*', name: 'not-found', component: AppNotFoundRouteView },
]

const routes: RouteRecordRaw[] = [{ path: '/', component: Layout, children: appRouteChildren }]

function useAppRouteAdmission(route: RouteLocationNormalized): void {
  const router = useRouter()
  const workspaceState = useStoreSelector(
    workspacesStore,
    (state) => ({
      restoredWorkspaceId: state.restoredWorkspaceId,
      workspaceOrder: state.workspaceOrder,
      workspaces: state.workspaces,
      workspaceMembershipReady: state.workspaceMembershipReady,
    }),
    (left, right) =>
      left.restoredWorkspaceId === right.restoredWorkspaceId &&
      left.workspaceOrder === right.workspaceOrder &&
      left.workspaces === right.workspaces &&
      left.workspaceMembershipReady === right.workspaceMembershipReady,
  )
  const admittedPath = computed(() => {
    if (route.name === 'home') {
      const workspaceSlug = initialWorkspaceRouteSlugFromStore(workspaceState.value)
      return workspaceSlug ? `/workspace/${workspaceSlug}/dashboard` : null
    }

    const workspaceSlug = routeStringParam(route.params.workspaceSlug)
    if (!workspaceSlug || !routeRequiresGitCapability(route)) return null
    const workspaceId = workspaceIdFromSlug(workspaceSlug)
    const workspace = workspaceId ? workspaceState.value.workspaces[workspaceId] : null
    return workspace?.capability.kind === 'filesystem' ? `/workspace/${workspaceSlug}/dashboard` : null
  })

  watch(
    admittedPath,
    (path) => {
      if (path && path !== route.path) void router.replace(path)
    },
    { immediate: true },
  )
}

function routeRequiresGitCapability(route: RouteLocationNormalized): boolean {
  const name = typeof route.name === 'string' ? route.name : ''
  return (
    name === 'workspace-new-worktree' || name.startsWith('workspace-branch') || name.startsWith('workspace-worktree')
  )
}

function routeStringParam(value: string | string[]): string | null {
  return typeof value === 'string' ? value : null
}

function settingsPageFromRoute(route: RouteLocationNormalized): SettingsPage {
  const page = routeStringParam(route.params.page)
  return isSettingsPage(page) ? page : 'general'
}

export const appRouter = createRouter({
  history: createAppHistoryPresentationHistory(createWebHistory()),
  routes,
})

export const AppRouterProvider = defineComponent({
  name: 'AppRouterProvider',
  setup() {
    return () => <RouterView />
  },
})

function workspaceRouteViewFromRoute(route: RouteLocationNormalized): WorkspaceRouteView | null {
  const workspaceSlug = route.params.workspaceSlug
  if (typeof workspaceSlug !== 'string') return null
  const routeName = typeof route.name === 'string' ? route.name : ''

  return workspaceRouteViewFromSlugChildRoute(workspaceSlug, {
    dashboard: routeName === 'workspace-dashboard',
    workspace: routeName.startsWith('workspace-root'),
    workspaceTabKey: routeName === 'workspace-root-tab' ? routeStringParam(route.params.tabKey) : null,
    workspaceTerminalSessionId:
      routeName === 'workspace-root-terminal' ? routeStringParam(route.params.terminalSessionId) : null,
    branchSlug: routeName.startsWith('workspace-branch') ? routeStringParam(route.params.branchSlug) : null,
    tabKey: routeName === 'workspace-branch-tab' ? routeStringParam(route.params.tabKey) : null,
    worktreeSlug: routeName.startsWith('workspace-worktree') ? routeStringParam(route.params.worktreeSlug) : null,
    worktreeTerminalSessionId:
      routeName === 'workspace-worktree-terminal' ? routeStringParam(route.params.terminalSessionId) : null,
    worktreeTabKey: routeName === 'workspace-worktree-tab' ? routeStringParam(route.params.tabKey) : null,
    newWorktree: routeName === 'workspace-new-worktree',
  })
}

export function initialWorkspaceRouteSlugFromStore(state: InitialWorkspaceRouteState): string | null {
  const restoredWorkspace = state.restoredWorkspaceId ? state.workspaces[state.restoredWorkspaceId] : null
  if (restoredWorkspace) return workspaceSlugFromId(restoredWorkspace.id)
  if (!state.workspaceMembershipReady) return null
  const firstWorkspaceId = state.workspaceOrder[0]
  const firstWorkspace = firstWorkspaceId ? state.workspaces[firstWorkspaceId] : null
  return firstWorkspace ? workspaceSlugFromId(firstWorkspace.id) : null
}

interface InitialWorkspaceRouteState extends RuntimeCoherentWorkspaceState {
  restoredWorkspaceId: WorkspaceId | null
  workspaceOrder: WorkspaceId[]
  workspaceMembershipReady: boolean
}

export function workspaceRouteViewFromSlugChildRoute(
  workspaceSlug: string,
  childRoute: WorkspaceChildRoute,
): WorkspaceRouteView | null {
  const workspaceId = workspaceIdFromSlug(workspaceSlug)
  return workspaceId ? workspaceRouteViewFromChildRoute(workspaceId, childRoute) : null
}

interface WorkspaceChildRoute {
  dashboard: boolean
  workspace?: boolean
  workspaceTabKey?: string | null
  workspaceTerminalSessionId?: string | null
  branchSlug: string | null
  tabKey?: string | null
  worktreeSlug?: string | null
  worktreeTerminalSessionId?: string | null
  worktreeTabKey?: string | null
  newWorktree: boolean
}

export function workspaceRouteViewFromChildRoute(
  workspaceId: WorkspaceId,
  childRoute: WorkspaceChildRoute,
): WorkspaceRouteView {
  if (childRoute.worktreeSlug) {
    const worktreePath = worktreePathFromSlug(childRoute.worktreeSlug)
    if (!worktreePath) return { kind: 'empty', workspaceId }
    return {
      kind: 'worktree',
      workspaceId,
      worktreePath,
      workspacePaneRoute: workspacePaneRouteFromParams(childRoute.worktreeTerminalSessionId, childRoute.worktreeTabKey),
    }
  }
  if (childRoute.branchSlug) {
    const branchName = branchNameFromSlug(childRoute.branchSlug)
    if (!branchName) return { kind: 'empty', workspaceId }
    return {
      kind: 'branch',
      workspaceId,
      branchName,
      workspacePaneRoute: workspacePaneStaticRouteFromTabKey(childRoute.tabKey),
    }
  }
  if (childRoute.newWorktree) return { kind: 'newWorktree', workspaceId }
  if (childRoute.dashboard) return { kind: 'dashboard', workspaceId }
  if (childRoute.workspace) {
    return {
      kind: 'workspace-root',
      workspaceId,
      workspacePaneRoute: workspacePaneRouteFromParams(
        childRoute.workspaceTerminalSessionId,
        childRoute.workspaceTabKey,
      ),
    }
  }
  return { kind: 'empty', workspaceId }
}

function workspacePaneStaticRouteFromTabKey(tabKey: string | null | undefined): ParsedBranchWorkspacePaneRouteTarget {
  if (!tabKey) return null
  if (isWorkspacePaneStaticTabType(tabKey)) return { kind: 'static', tab: tabKey }
  return { kind: 'invalid-static', tabKey }
}

function workspacePaneRouteFromParams(
  terminalSessionId: string | null | undefined,
  tabKey: string | null | undefined,
): ParsedWorkspacePaneRoute | null {
  if (terminalSessionId) return { kind: 'terminal', terminalSessionId }
  if (!tabKey) return null
  if (isWorkspacePaneStaticTabType(tabKey)) return { kind: 'static', tab: tabKey }
  return { kind: 'invalid-static', tabKey }
}

export function appRouterCallbacks(routeActions: AppRouteNavigation) {
  return {
    onRouteSettingsPageChange: (page: SettingsPage | null) => {
      applyAppSettingsRouteChange(routeActions, page)
    },
    onOpenWorkspaceNavigator: (workspaceId: WorkspaceId) => routeActions.openWorkspaceNavigator(workspaceId),
    onOpenWorkspaceRootPane: (workspaceId: WorkspaceId) => routeActions.openWorkspaceRootPane(workspaceId),
    onOpenWorkspaceDashboard: (workspaceId: WorkspaceId) => routeActions.openWorkspaceDashboard(workspaceId),
    onOpenRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.openRepoNewWorktree(workspaceId),
    onCancelRepoNewWorktree: (workspaceId: WorkspaceId) => routeActions.cancelRepoNewWorktree(workspaceId),
    onReplaceRepoWorktree: (
      workspaceId: WorkspaceId,
      worktreePath: string,
      navigationGeneration: AppNavigationGeneration,
    ) => routeActions.openRepoWorktree(workspaceId, worktreePath, { replace: true, navigationGeneration }),
  }
}

export function applyAppSettingsRouteChange(
  routeActions: AppSettingsRouteActions,
  nextPage: SettingsPage | null,
): void {
  if (nextPage) routeActions.openSettings(nextPage)
  else routeActions.closeSettings()
}

interface AppSettingsRouteActions {
  openSettings: AppRouteNavigation['openSettings']
  closeSettings: AppRouteNavigation['closeSettings']
}
