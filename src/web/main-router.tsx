import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { App } from '#/web/App.tsx'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

const rootRoute = createRootRoute()

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/workspace' })
  },
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace',
  component: WorkspaceRoute,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/settings/general' })
  },
})

const settingsGeneralRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/general',
  component: SettingsGeneralRoute,
})

const settingsShortcutsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/shortcuts',
  component: SettingsShortcutsRoute,
})

const settingsNotificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/notifications',
  component: SettingsNotificationsRoute,
})

const settingsSshRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/ssh',
  component: SettingsSshRoute,
})

const settingsSyncRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/sync',
  component: SettingsSyncRoute,
})

const settingsAppsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/apps',
  component: SettingsAppsRoute,
})

const settingsGitHubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/github',
  component: SettingsGitHubRoute,
})

const settingsLanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/lan',
  beforeLoad: () => {
    if (getInitialBootstrap().runtime.kind !== 'electron') {
      throw redirect({ to: '/settings/general' })
    }
  },
  component: SettingsLanRoute,
})

const settingsAboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/about',
  component: SettingsAboutRoute,
})

const mainRouteTree = rootRoute.addChildren([
  indexRoute,
  workspaceRoute,
  settingsIndexRoute,
  settingsGeneralRoute,
  settingsShortcutsRoute,
  settingsNotificationsRoute,
  settingsSshRoute,
  settingsSyncRoute,
  settingsAppsRoute,
  settingsGitHubRoute,
  settingsLanRoute,
  settingsAboutRoute,
])

export const mainRouter = createRouter({
  routeTree: mainRouteTree,
  history: createBrowserHistory(),
})

function WorkspaceRoute() {
  const navigate = useNavigate()
  return (
    <App
      routeSettingsPage={null}
      onRouteSettingsPageChange={(nextPage) => {
        if (nextPage) void navigate({ to: settingsRoutePath(nextPage), replace: false })
      }}
    />
  )
}

function SettingsGeneralRoute() {
  return <SettingsRoutePage settingsPage="general" />
}

function SettingsShortcutsRoute() {
  return <SettingsRoutePage settingsPage="shortcuts" />
}

function SettingsNotificationsRoute() {
  return <SettingsRoutePage settingsPage="notifications" />
}

function SettingsSshRoute() {
  return <SettingsRoutePage settingsPage="ssh" />
}

function SettingsSyncRoute() {
  return <SettingsRoutePage settingsPage="sync" />
}

function SettingsAppsRoute() {
  return <SettingsRoutePage settingsPage="apps" />
}

function SettingsGitHubRoute() {
  return <SettingsRoutePage settingsPage="github" />
}

function SettingsLanRoute() {
  return <SettingsRoutePage settingsPage="lan" />
}

function SettingsAboutRoute() {
  return <SettingsRoutePage settingsPage="about" />
}

function settingsRoutePath(page: SettingsPage) {
  return `/settings/${page}` as const
}

function SettingsRoutePage({ settingsPage }: { settingsPage: SettingsPage }) {
  const navigate = useNavigate()
  return (
    <App
      routeSettingsPage={settingsPage}
      onRouteSettingsPageChange={(nextPage) => {
        void navigate({ to: nextPage ? settingsRoutePath(nextPage) : '/workspace', replace: false })
      }}
    />
  )
}

export function MainWindowRouterProvider() {
  return (
    <>
      <RouterProvider router={mainRouter} />
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </>
  )
}
