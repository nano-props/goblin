import type { HistoryState, RouteLocationRaw, Router } from 'vue-router'

export function appRouteHref(router: Router, target: RouteLocationRaw): string {
  return router.resolve(target).href
}

export function currentAppRouteHref(router: Router): string {
  return router.currentRoute.value.fullPath
}

export async function navigateAppRoute(
  router: Router,
  target: RouteLocationRaw,
  replace: boolean,
  state: HistoryState,
): Promise<void> {
  const resolved = router.resolve(target)
  const location: RouteLocationRaw = {
    path: resolved.path,
    query: resolved.query,
    hash: resolved.hash,
    state,
  }
  if (replace) await router.replace(location)
  else await router.push(location)
}
