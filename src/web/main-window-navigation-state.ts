export function visibleRepoIdForMainWindow(
  routeRepoId: string | null | undefined,
  activeId: string | null,
  repos: Record<string, unknown>,
): string | null {
  return routeRepoId && repos[routeRepoId] ? routeRepoId : activeId
}

export function nextRouteRepoIdAfterClose(
  order: string[],
  activeId: string | null,
  closedId: string,
): string | null | undefined {
  if (activeId !== closedId) return undefined
  const idx = order.indexOf(closedId)
  if (idx === -1) return null
  return order[idx + 1] ?? order[idx - 1] ?? null
}
