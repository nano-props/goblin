import type { WorkspacePaneRouteTarget } from '#/web/App.tsx'
import type { PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export interface WorkspacePaneRouteNavigation {
  openRepoBranch: (
    repoId: string,
    branchName: string,
    options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
  ) => boolean
  openRepoBranchTab: (
    repoId: string,
    branchName: string,
    tab: WorkspacePaneStaticTabType,
    options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
  ) => boolean
  openRepoBranchTerminal: (
    repoId: string,
    branchName: string,
    terminalSessionId: string,
    options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
  ) => boolean
}

export function openResolvedWorkspacePaneRoute(
  routeNavigation: WorkspacePaneRouteNavigation,
  repoId: string,
  branchName: string,
  route: WorkspacePaneRouteTarget,
  options?: { replace?: boolean; presentationToken?: PrimaryWindowPresentationToken; onCommit?: () => void },
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
