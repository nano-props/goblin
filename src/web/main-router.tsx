import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { App } from '#/web/App.tsx'
import { Layout } from '#/web/Layout.tsx'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

const rootRoute = createRootRoute()

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: Layout,
})

const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/workspace' })
  },
})

const workspaceRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/workspace',
  component: WorkspaceRoute,
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
    if (params.page === 'lan' && getInitialBootstrap().runtime.kind !== 'electron') {
      throw redirect({ to: '/settings/general' })
    }
  },
})

function WorkspaceRoute() {
  const navigate = useNavigate()
  return (
    <App
      routeSettingsPage={null}
      onRouteSettingsPageChange={(nextPage) => {
        if (nextPage) void navigate({ to: `/settings/${nextPage}` })
      }}
    />
  )
}

function SettingsRoute() {
  const { page } = settingsRoute.useParams()
  const navigate = useNavigate()
  return (
    <App
      routeSettingsPage={page as SettingsPage}
      onRouteSettingsPageChange={(nextPage) => {
        void navigate({ to: nextPage ? `/settings/${nextPage}` : '/workspace' })
      }}
    />
  )
}

const mainRouteTree = rootRoute.addChildren([
  layoutRoute.addChildren([indexRoute, workspaceRoute, settingsIndexRoute, settingsRoute]),
])

export const mainRouter = createRouter({
  routeTree: mainRouteTree,
  history: createBrowserHistory(),
})

export function MainWindowRouterProvider() {
  return <RouterProvider router={mainRouter} />
}
