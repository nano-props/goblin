import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { PrimaryWindowNavigationGeneration } from '#/web/primary-window-navigation-lifecycle.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

interface WorkspacePaneRouteNavigationOptions {
  replace?: boolean
  navigationGeneration?: PrimaryWindowNavigationGeneration
  onCommit?: () => void
  onAbandon?: () => void
  routePrecondition?: { kind: 'exact-route'; route: WorkspacePaneRouteTarget } | { kind: 'current-workspace-target' }
}

export interface WorkspacePaneRouteNavigation {
  openRepoBranch: (repoId: WorkspaceId, branchName: string, options?: WorkspacePaneRouteNavigationOptions) => boolean
  openRepoBranchTab: (
    repoId: WorkspaceId,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: WorkspacePaneRouteNavigationOptions,
  ) => boolean
  openRepoBranchTerminal: (
    repoId: WorkspaceId,
    branchName: string,
    terminalSessionId: string,
    options?: WorkspacePaneRouteNavigationOptions,
  ) => boolean
}

export function openResolvedWorkspacePaneRoute(
  routeNavigation: WorkspacePaneRouteNavigation,
  repoId: WorkspaceId,
  branchName: string,
  route: WorkspacePaneRouteTarget,
  options?: WorkspacePaneRouteNavigationOptions,
): boolean {
  if (!route) {
    return options === undefined
      ? routeNavigation.openRepoBranch(repoId, branchName)
      : routeNavigation.openRepoBranch(repoId, branchName, options)
  }
  if (route.kind === 'static') {
    return options === undefined
      ? routeNavigation.openRepoBranchTab(repoId, branchName, route.tab)
      : routeNavigation.openRepoBranchTab(repoId, branchName, route.tab, options)
  }
  if (route.kind === 'terminal') {
    return options === undefined
      ? routeNavigation.openRepoBranchTerminal(repoId, branchName, route.terminalSessionId)
      : routeNavigation.openRepoBranchTerminal(repoId, branchName, route.terminalSessionId, options)
  }
  return false
}
