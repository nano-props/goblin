import { defineComponent, shallowRef, watch } from 'vue'
import { createRouter, createWebHistory, RouterView } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { DialogRoot, DialogTitle, DialogDescription } from 'reka-ui'
import { createAppHistoryPresentationHistory } from '#/web/app/navigation/history-presentation.ts'
import { settingsRoute } from '#/web/app/navigation/settings-routes.ts'
import { useBootstrapLoadingPresentation } from '#/web/app/bootstrap/bootstrap-loading-presentation.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { DialogContent } from '#/web/components/ui/dialog.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { navigationLog } from '#/web/logger.ts'

// These URLs share a mounted workspace page; lazy loading must not remount it on pane changes.
const workspaceRouteView = () =>
  import('#/web/app/navigation/workspace-route-view.tsx').then(({ WorkspaceRouteView }) => WorkspaceRouteView)

const appRouteChildren: RouteRecordRaw[] = [
  {
    path: '',
    name: 'home',
    component: () => import('#/web/app/navigation/home-route-view.tsx').then(({ HomeRouteView }) => HomeRouteView),
  },
  {
    path: 'open',
    name: 'open-workspace',
    component: () =>
      import('#/web/app/navigation/workspace-open-route-view.tsx').then(
        ({ WorkspaceOpenRouteView }) => WorkspaceOpenRouteView,
      ),
  },
  settingsRoute,
  { path: 'workspace/:workspaceSlug', name: 'workspace', component: workspaceRouteView },
  { path: 'workspace/:workspaceSlug/dashboard', name: 'workspace-dashboard', component: workspaceRouteView },
  { path: 'workspace/:workspaceSlug/root', name: 'workspace-root', component: workspaceRouteView },
  { path: 'workspace/:workspaceSlug/root/tab/:tabKey', name: 'workspace-root-tab', component: workspaceRouteView },
  {
    path: 'workspace/:workspaceSlug/root/terminal/:terminalSessionId',
    name: 'workspace-root-terminal',
    component: workspaceRouteView,
  },
  { path: 'workspace/:workspaceSlug/branch/:branchSlug', name: 'workspace-branch', component: workspaceRouteView },
  {
    path: 'workspace/:workspaceSlug/branch/:branchSlug/tab/:tabKey',
    name: 'workspace-branch-tab',
    component: workspaceRouteView,
  },
  { path: 'workspace/:workspaceSlug/worktree/new', name: 'workspace-new-worktree', component: workspaceRouteView },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug',
    name: 'workspace-worktree',
    component: workspaceRouteView,
  },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug/tab/:tabKey',
    name: 'workspace-worktree-tab',
    component: workspaceRouteView,
  },
  {
    path: 'workspace/:workspaceSlug/worktree/:worktreeSlug/terminal/:terminalSessionId',
    name: 'workspace-worktree-terminal',
    component: workspaceRouteView,
  },
  {
    path: ':pathMatch(.*)*',
    name: 'not-found',
    component: () =>
      import('#/web/app/navigation/not-found-route-view.tsx').then(({ AppNotFoundRouteView }) => AppNotFoundRouteView),
  },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'app-layout',
    component: () => import('#/web/Layout.tsx').then(({ Layout }) => Layout),
    children: appRouteChildren,
  },
]

export const appRouter = createRouter({
  history: createAppHistoryPresentationHistory(createWebHistory()),
  routes,
})

const routeLoadFailure = shallowRef<{ error: unknown; fullPath: string } | null>(null)

appRouter.onError((error, to, from) => {
  navigationLog.error('route could not be loaded', { error, path: to.path })
  // A late download failure must not cover a newer committed route.
  if (appRouter.currentRoute.value !== from) return
  routeLoadFailure.value = { error, fullPath: to.fullPath }
})

appRouter.afterEach((_to, _from, failure) => {
  if (!failure) routeLoadFailure.value = null
})

export const AppRouterProvider = defineComponent({
  name: 'AppRouterProvider',
  setup() {
    const t = useT()
    const bootstrapLoading = useBootstrapLoadingPresentation()
    watch(
      routeLoadFailure,
      (failure) => {
        if (failure) bootstrapLoading.hide()
      },
      { immediate: true },
    )
    return () => (
      <>
        <RouterView />
        {routeLoadFailure.value ? (
          <DialogRoot open>
            <DialogContent
              showCloseButton={false}
              onEscapeKeyDown={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => event.preventDefault()}
            >
              <DialogTitle class="text-sm font-semibold text-foreground">{t('error.route-load-title')}</DialogTitle>
              <DialogDescription class="text-xs text-muted-foreground">{t('error.route-load-hint')}</DialogDescription>
              {/* A document navigation also clears the browser's failed module cache. */}
              <Button asChild variant="outline">
                <a href={routeLoadFailure.value.fullPath}>{t('help.row.reload-page')}</a>
              </Button>
            </DialogContent>
          </DialogRoot>
        ) : null}
      </>
    )
  },
})
