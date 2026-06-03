import {
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router'
import { App, type MainWindowRoutePatch } from '#/web/App.tsx'
import { APP_OVERLAY_KEYS, type AppOverlayKey } from '#/web/hooks/useAppOverlays.ts'
import { isDetailTab } from '#/web/lib/detail-tabs.ts'
import { patchMainWindowSearch, type MainWindowSearch } from '#/web/main-router-search.ts'
import { isSettingsPage } from '#/shared/settings-pages.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
const rootRoute = createRootRoute()

function validateMainWindowSearch(search: Record<string, unknown>): MainWindowSearch {
  const repo = typeof search.repo === 'string' && search.repo.length > 0 ? search.repo : undefined
  const branch = typeof search.branch === 'string' && search.branch.length > 0 ? search.branch : undefined
  const overlay =
    typeof search.overlay === 'string' && APP_OVERLAY_KEYS.includes(search.overlay as AppOverlayKey)
      ? (search.overlay as AppOverlayKey)
      : undefined
  const detailTab = typeof search.detailTab === 'string' && isDetailTab(search.detailTab) ? search.detailTab : undefined
  return {
    ...(repo ? { repo } : {}),
    ...(branch ? { branch } : {}),
    ...(overlay ? { overlay } : {}),
    ...(detailTab ? { detailTab } : {}),
  }
}

const mainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: validateMainWindowSearch,
  component: MainWindowRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$page',
  validateSearch: validateMainWindowSearch,
  component: SettingsRoute,
})

const mainRouteTree = rootRoute.addChildren([mainRoute, settingsRoute])

export const mainRouter = createRouter({
  routeTree: mainRouteTree,
  history: createBrowserHistory(),
})

function MainWindowRoute() {
  const navigate = useNavigate()
  const search = mainRoute.useSearch() as MainWindowSearch
  const updateRoute = (patch: MainWindowRoutePatch) => {
    if ('settingsPage' in patch && patch.settingsPage) {
      void navigate({
        to: '/settings/$page',
        params: { page: patch.settingsPage },
        search: patchMainWindowSearch(search, patch),
        replace: true,
      } as any)
      return
    }
    void navigate({
      to: '/',
      search: patchMainWindowSearch(search, patch) as any,
      replace: true,
    })
  }

  return (
    <App
      routeRepoId={search.repo ?? null}
      routeOverlay={search.overlay ?? null}
      routeBranch={search.branch ?? null}
      routeDetailTab={search.detailTab ?? null}
      onRouteRepoChange={(repoId) => updateRoute({ repoId })}
      onRouteOverlayChange={(overlay) => updateRoute({ overlay })}
      onRouteSettingsPageChange={(settingsPage) => updateRoute({ settingsPage })}
      onRouteBranchChange={(branch) => updateRoute({ branch })}
      onRouteDetailTabChange={(detailTab) => updateRoute({ detailTab })}
      onRouteChange={updateRoute}
    />
  )
}

function SettingsRoute() {
  const navigate = useNavigate()
  const search = settingsRoute.useSearch() as MainWindowSearch
  const { page } = settingsRoute.useParams()
  const settingsPage: SettingsPage = isSettingsPage(page) ? page : 'general'
  const updateRoute = (patch: MainWindowRoutePatch) => {
    const nextSearch = patchMainWindowSearch(search, patch)
    if ('settingsPage' in patch && patch.settingsPage === null) {
      void navigate({
        to: '/',
        search: nextSearch as any,
        replace: true,
      })
      return
    }
    void navigate({
      to: '/settings/$page',
      params: { page: ('settingsPage' in patch ? patch.settingsPage : settingsPage) ?? settingsPage },
      search: nextSearch,
      replace: true,
    } as any)
  }

  return (
    <App
      routeRepoId={search.repo ?? null}
      routeOverlay={search.overlay ?? null}
      routeSettingsPage={settingsPage}
      routeBranch={search.branch ?? null}
      routeDetailTab={search.detailTab ?? null}
      onRouteRepoChange={(repoId) => updateRoute({ repoId })}
      onRouteOverlayChange={(overlay) => updateRoute({ overlay })}
      onRouteSettingsPageChange={(nextPage) => updateRoute({ settingsPage: nextPage })}
      onRouteBranchChange={(branch) => updateRoute({ branch })}
      onRouteDetailTabChange={(detailTab) => updateRoute({ detailTab })}
      onRouteChange={updateRoute}
    />
  )
}

export function MainWindowRouterProvider() {
  return <RouterProvider router={mainRouter} />
}
