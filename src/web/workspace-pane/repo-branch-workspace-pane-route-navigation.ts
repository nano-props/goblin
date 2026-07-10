import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export interface RepoBranchWorkspacePaneRouteNavigation {
  openRepoBranch: (repoId: string, branchName: string, options?: { replace?: boolean }) => boolean
  openRepoBranchTab: (
    repoId: string,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean },
  ) => boolean
  openRepoBranchTerminal: (
    repoId: string,
    branchName: string,
    terminalSessionId: string,
    options?: { replace?: boolean },
  ) => boolean
}

export function openResolvedRepoBranchWorkspacePaneRoute(
  routeNavigation: RepoBranchWorkspacePaneRouteNavigation,
  repoId: string,
  branchName: string,
  route: RepoBranchWorkspacePaneRoute | null,
  options?: { replace?: boolean },
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
