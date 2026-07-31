import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'

export function workspacePaneRouteFromBranchHref(
  currentHref: string,
  branchRootHref: string,
): WorkspacePaneRouteTarget | undefined {
  const route = parsedWorkspacePaneRouteFromTargetHref(currentHref, branchRootHref)
  return route?.kind === 'invalid-static' ? undefined : route
}

export function parsedWorkspacePaneRouteFromTargetHref(
  currentHref: string,
  targetRootHref: string,
): ParsedWorkspacePaneRouteTarget | undefined {
  const currentPath = pathFromHref(currentHref)
  const targetRootPath = pathFromHref(targetRootHref)
  if (!currentPath || !targetRootPath) return undefined
  if (currentPath === targetRootPath) return null
  const prefix = `${targetRootPath}/`
  if (!currentPath.startsWith(prefix)) return undefined
  const [kind, encodedValue, ...rest] = currentPath.slice(prefix.length).split('/')
  if (!encodedValue || rest.length > 0) return undefined
  let value: string
  try {
    value = decodeURIComponent(encodedValue)
  } catch {
    return undefined
  }
  if (kind === 'tab') {
    return isWorkspacePaneStaticTabType(value)
      ? { kind: 'static', tab: value }
      : { kind: 'invalid-static', tabKey: value }
  }
  if (kind === 'terminal') return { kind: 'terminal', terminalSessionId: value }
  return undefined
}

export function routeReturnSearch(
  href: string | null,
  targetPath: string,
  currentRouteFamily = targetPath,
): { returnTo?: string } {
  if (!href) return {}
  const path = pathFromHref(href)
  if (!path) return {}
  if (path === targetPath || path.startsWith(currentRouteFamily)) {
    const existingReturnTo = returnToFromHref(href)
    return existingReturnTo ? { returnTo: existingReturnTo } : {}
  }
  return { returnTo: href }
}

export function returnToFromHref(href: string | null): string | null {
  if (!href) return null
  const queryStart = href.indexOf('?')
  if (queryStart < 0) return null
  const hashStart = href.indexOf('#', queryStart)
  const search = href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
  const returnTo = new URLSearchParams(search).get('returnTo')
  return isAppRelativeHref(returnTo) ? returnTo : null
}

function isAppRelativeHref(href: string | null): href is string {
  return !!href && href.startsWith('/') && !href.startsWith('//')
}

function pathFromHref(href: string): string | null {
  const queryStart = href.indexOf('?')
  const hashStart = href.indexOf('#')
  const end = queryStart >= 0 ? queryStart : hashStart >= 0 ? hashStart : href.length
  const path = href.slice(0, end)
  return path.startsWith('/') ? path : null
}
