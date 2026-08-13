import type { BranchWorkspacePaneRouteTarget, ParsedWorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

interface WorkspacePaneRouteNavigationOptions {
  replace?: boolean
  navigationGeneration?: AppNavigationGeneration
  onCommit?: () => void
  onAbandon?: () => void
  routePrecondition?:
    { kind: 'exact-route'; route: ParsedWorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export interface WorkspacePaneRouteNavigation {
  openRepoBranch: (repoId: WorkspaceId, branchName: string, options?: WorkspacePaneRouteNavigationOptions) => boolean
  openRepoBranchTab: (
    repoId: WorkspaceId,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: WorkspacePaneRouteNavigationOptions,
  ) => boolean
}

export function openResolvedWorkspacePaneRoute(
  routeNavigation: WorkspacePaneRouteNavigation,
  repoId: WorkspaceId,
  branchName: string,
  route: BranchWorkspacePaneRouteTarget,
  options?: WorkspacePaneRouteNavigationOptions,
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
