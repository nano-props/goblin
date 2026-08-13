import type { BranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type {
  BranchAppRouteNavigationOptions,
  RepoBranchWorkspacePaneRouteNavigation,
} from '#/web/app-route-navigation.ts'

export function openResolvedWorkspacePaneRoute(
  routeNavigation: RepoBranchWorkspacePaneRouteNavigation,
  repoId: WorkspaceId,
  branchName: string,
  route: BranchWorkspacePaneRouteTarget,
  options?: BranchAppRouteNavigationOptions,
): boolean {
  if (!route) {
    return options === undefined
      ? routeNavigation.openRepoBranch(repoId, branchName)
      : routeNavigation.openRepoBranch(repoId, branchName, options)
  }
  return options === undefined
    ? routeNavigation.openRepoBranchTab(repoId, branchName, route.tab)
    : routeNavigation.openRepoBranchTab(repoId, branchName, route.tab, options)
}
