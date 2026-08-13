import type { RouteLocationRaw, Router } from 'vue-router'
import type {
  BranchWorkspacePaneRouteTarget,
  ParsedBranchWorkspacePaneRouteTarget,
  ParsedWorkspacePaneRouteTarget,
  WorkspacePaneRouteTarget,
} from '#/web/App.tsx'
import { appNavigationIsCurrent, appNavigationState } from '#/web/app-navigation-lifecycle.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import { appRoutePreconditionMatches, settleOwnedAppRouteCommit } from '#/web/app-route-commit.ts'
import { parsedWorkspacePaneRouteFromTargetHref } from '#/web/app-route-href.ts'
import type { AppRouteNavigationOptions, BranchAppRouteNavigationOptions } from '#/web/app-route-navigation.ts'
import type { FilesystemWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { appRouteHref, currentAppRouteHref, navigateAppRoute } from '#/web/app-router-location.ts'
import { branchSlugFromName, worktreeSlugFromPath } from '#/web/workspace-route-slugs.ts'

export async function commitFilesystemWorkspacePaneRoute(input: {
  router: Router
  workspaceSlug: string
  paneTarget: FilesystemWorkspacePaneTabsTarget
  route: WorkspacePaneRouteTarget
  options?: AppRouteNavigationOptions
}): Promise<boolean> {
  const { router, workspaceSlug, paneTarget, route, options } = input
  if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
    return abandonAppRouteCommit(options)
  }
  const routeLocation = (candidate: ParsedWorkspacePaneRouteTarget): RouteLocationRaw =>
    filesystemWorkspacePaneRouteLocation(workspaceSlug, paneTarget, candidate)
  const routeHref = (candidate: ParsedWorkspacePaneRouteTarget): string =>
    appRouteHref(router, routeLocation(candidate))
  const currentHref = currentAppRouteHref(router)
  const rootHref = routeHref(null)
  const expectedCurrentHref = expectedCurrentWorkspacePaneHref(
    currentHref,
    rootHref,
    options?.routePrecondition,
    routeHref,
  )
  if (expectedCurrentHref === null) return abandonAppRouteCommit(options)
  const target = routeLocation(route)
  return await settleOwnedAppRouteCommit({
    generation: options?.navigationGeneration,
    targetHref: appRouteHref(router, target),
    expectedCurrentHref,
    commitEffect: options?.onCommit,
    abandonEffect: options?.onAbandon,
    currentHref: () => currentAppRouteHref(router),
    navigate: async (navigationGeneration) => {
      await navigateAppRoute(router, target, options?.replace ?? false, appNavigationState({}, navigationGeneration))
    },
  })
}

export async function commitBranchWorkspacePaneRoute(input: {
  router: Router
  workspaceSlug: string
  branchName: string
  route: BranchWorkspacePaneRouteTarget
  options?: BranchAppRouteNavigationOptions
}): Promise<boolean> {
  const { router, workspaceSlug, branchName, route, options } = input
  if (options?.navigationGeneration && !appNavigationIsCurrent(options.navigationGeneration)) {
    return abandonAppRouteCommit(options)
  }
  const branchSlug = branchSlugFromName(branchName)
  const routeLocation = (candidate: ParsedBranchWorkspacePaneRouteTarget): RouteLocationRaw =>
    branchWorkspacePaneRouteLocation(workspaceSlug, branchSlug, candidate)
  const routeHref = (candidate: ParsedBranchWorkspacePaneRouteTarget): string =>
    appRouteHref(router, routeLocation(candidate))
  const currentHref = currentAppRouteHref(router)
  const branchRootHref = routeHref(null)
  const expectedCurrentHref = expectedCurrentWorkspacePaneHref(
    currentHref,
    branchRootHref,
    options?.routePrecondition,
    routeHref,
  )
  if (expectedCurrentHref === null) return abandonAppRouteCommit(options)
  const target = branchWorkspacePaneRouteLocation(workspaceSlug, branchSlug, route)
  const targetHref = appRouteHref(router, target)
  if (currentHref === targetHref && appRoutePreconditionMatches(currentHref, expectedCurrentHref)) {
    options?.onCommit?.()
    return true
  }
  return await settleOwnedAppRouteCommit({
    generation: options?.navigationGeneration,
    commitEffect: options?.onCommit,
    abandonEffect: options?.onAbandon,
    targetHref,
    expectedCurrentHref,
    currentHref: () => currentAppRouteHref(router),
    navigate: async (navigationGeneration: AppNavigationGeneration) => {
      await navigateAppRoute(router, target, options?.replace ?? false, appNavigationState({}, navigationGeneration))
    },
  })
}

function expectedCurrentWorkspacePaneHref<Route>(
  currentHref: string,
  rootHref: string,
  precondition: { kind: 'exact-route'; route: Route } | { kind: 'current-workspace-target' } | undefined,
  routeHref: (route: Route) => string,
): string | null | undefined {
  if (!precondition) return undefined
  if (precondition.kind === 'exact-route') return routeHref(precondition.route)
  return parsedWorkspacePaneRouteFromTargetHref(currentHref, rootHref) !== undefined ? currentHref : null
}

function filesystemWorkspacePaneRouteLocation(
  workspaceSlug: string,
  paneTarget: FilesystemWorkspacePaneTabsTarget,
  route: ParsedWorkspacePaneRouteTarget,
): RouteLocationRaw {
  if (paneTarget.kind === 'workspace-root') {
    if (route === null) return { name: 'workspace-root', params: { workspaceSlug } }
    if (route.kind === 'static' || route.kind === 'invalid-static') {
      return {
        name: 'workspace-root-tab',
        params: { workspaceSlug, tabKey: route.kind === 'static' ? route.tab : route.tabKey },
      }
    }
    return {
      name: 'workspace-root-terminal',
      params: { workspaceSlug, terminalSessionId: route.terminalSessionId },
    }
  }

  const worktreeParams = { workspaceSlug, worktreeSlug: worktreeSlugFromPath(paneTarget.worktreePath) }
  if (route === null) return { name: 'workspace-worktree', params: worktreeParams }
  if (route.kind === 'static' || route.kind === 'invalid-static') {
    return {
      name: 'workspace-worktree-tab',
      params: { ...worktreeParams, tabKey: route.kind === 'static' ? route.tab : route.tabKey },
    }
  }
  return {
    name: 'workspace-worktree-terminal',
    params: { ...worktreeParams, terminalSessionId: route.terminalSessionId },
  }
}

function branchWorkspacePaneRouteLocation(
  workspaceSlug: string,
  branchSlug: string,
  route: ParsedBranchWorkspacePaneRouteTarget,
): RouteLocationRaw {
  if (route === null) return { name: 'workspace-branch', params: { workspaceSlug, branchSlug } }
  return {
    name: 'workspace-branch-tab',
    params: { workspaceSlug, branchSlug, tabKey: route.kind === 'static' ? route.tab : route.tabKey },
  }
}

function abandonAppRouteCommit(options: AppRouteNavigationOptions | undefined): false {
  options?.onAbandon?.()
  return false
}
