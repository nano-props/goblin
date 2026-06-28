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
    throw redirect({ to: '/app' })
  },
})

const appRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/app',
  component: AppRoute,
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

function AppRoute() {
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
        void navigate({ to: nextPage ? `/settings/${nextPage}` : '/app' })
      }}
    />
  )
}

const primaryWindowRouteTree = rootRoute.addChildren([
  layoutRoute.addChildren([indexRoute, appRoute, settingsIndexRoute, settingsRoute]),
])

const primaryWindowRouter = createRouter({
  routeTree: primaryWindowRouteTree,
  history: createBrowserHistory(),
})

export function PrimaryWindowRouterProvider() {
  return <RouterProvider router={primaryWindowRouter} />
}
