import type { RouteLocationNormalized } from 'vue-router'
import { isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { RuntimeCoherentWorkspaceState } from '#/web/stores/workspaces/types.ts'
import {
  branchNameFromSlug,
  workspaceIdFromSlug,
  workspaceSlugFromId,
  worktreePathFromSlug,
} from '#/web/app/navigation/workspace-route-slugs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export type WorkspaceRouteView =
  | { kind: 'empty'; workspaceId: WorkspaceId }
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | {
      kind: 'worktree'
      workspaceId: WorkspaceId
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'dashboard'; workspaceId: WorkspaceId }
  | {
      kind: 'branch'
      workspaceId: WorkspaceId
      branchName: string
      workspacePaneRoute: ParsedBranchWorkspacePaneRouteTarget
    }
  | { kind: 'newWorktree'; workspaceId: WorkspaceId }

export type WorkspacePaneRoute =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type WorkspacePaneRouteTarget = WorkspacePaneRoute | null
export type BranchWorkspacePaneRouteTarget = Extract<WorkspacePaneRoute, { kind: 'static' }> | null
export type ParsedWorkspacePaneRoute = WorkspacePaneRoute | { kind: 'invalid-static'; tabKey: string }
export type ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRoute | null
export type ParsedBranchWorkspacePaneRouteTarget =
  BranchWorkspacePaneRouteTarget | Extract<ParsedWorkspacePaneRoute, { kind: 'invalid-static' }>

export function workspaceRouteViewFromRoute(route: RouteLocationNormalized): WorkspaceRouteView | null {
  const workspaceSlug = route.params.workspaceSlug
  if (typeof workspaceSlug !== 'string') return null
  const routeName = typeof route.name === 'string' ? route.name : ''

  return workspaceRouteViewFromSlugChildRoute(workspaceSlug, {
    dashboard: routeName === 'workspace-dashboard',
    workspaceRoot: routeName.startsWith('workspace-root'),
    workspaceRootTabKey: routeName === 'workspace-root-tab' ? routeStringParam(route.params.tabKey) : null,
    workspaceRootTerminalSessionId:
      routeName === 'workspace-root-terminal' ? routeStringParam(route.params.terminalSessionId) : null,
    branchSlug: routeName.startsWith('workspace-branch') ? routeStringParam(route.params.branchSlug) : null,
    tabKey: routeName === 'workspace-branch-tab' ? routeStringParam(route.params.tabKey) : null,
    worktreeSlug: routeName.startsWith('workspace-worktree') ? routeStringParam(route.params.worktreeSlug) : null,
    worktreeTerminalSessionId:
      routeName === 'workspace-worktree-terminal' ? routeStringParam(route.params.terminalSessionId) : null,
    worktreeTabKey: routeName === 'workspace-worktree-tab' ? routeStringParam(route.params.tabKey) : null,
    newWorktree: routeName === 'workspace-new-worktree',
  })
}

export function initialWorkspaceRouteSlugFromStore(state: InitialWorkspaceRouteState): string | null {
  const restoredWorkspace = state.restoredWorkspaceId ? state.workspaces[state.restoredWorkspaceId] : null
  if (restoredWorkspace) return workspaceSlugFromId(restoredWorkspace.id)
  if (!state.workspaceMembershipReady) return null
  const firstWorkspaceId = state.workspaceOrder[0]
  const firstWorkspace = firstWorkspaceId ? state.workspaces[firstWorkspaceId] : null
  return firstWorkspace ? workspaceSlugFromId(firstWorkspace.id) : null
}

interface InitialWorkspaceRouteState extends RuntimeCoherentWorkspaceState {
  restoredWorkspaceId: WorkspaceId | null
  workspaceOrder: WorkspaceId[]
  workspaceMembershipReady: boolean
}

export function workspaceRouteViewFromSlugChildRoute(
  workspaceSlug: string,
  childRoute: WorkspaceChildRoute,
): WorkspaceRouteView | null {
  const workspaceId = workspaceIdFromSlug(workspaceSlug)
  return workspaceId ? workspaceRouteViewFromChildRoute(workspaceId, childRoute) : null
}

interface WorkspaceChildRoute {
  dashboard: boolean
  workspaceRoot?: boolean
  workspaceRootTabKey?: string | null
  workspaceRootTerminalSessionId?: string | null
  branchSlug: string | null
  tabKey?: string | null
  worktreeSlug?: string | null
  worktreeTerminalSessionId?: string | null
  worktreeTabKey?: string | null
  newWorktree: boolean
}

export function workspaceRouteViewFromChildRoute(
  workspaceId: WorkspaceId,
  childRoute: WorkspaceChildRoute,
): WorkspaceRouteView {
  if (childRoute.worktreeSlug) {
    const worktreePath = worktreePathFromSlug(childRoute.worktreeSlug)
    if (!worktreePath) return { kind: 'empty', workspaceId }
    return {
      kind: 'worktree',
      workspaceId,
      worktreePath,
      workspacePaneRoute: workspacePaneRouteFromParams(childRoute.worktreeTerminalSessionId, childRoute.worktreeTabKey),
    }
  }
  if (childRoute.branchSlug) {
    const branchName = branchNameFromSlug(childRoute.branchSlug)
    if (!branchName) return { kind: 'empty', workspaceId }
    return {
      kind: 'branch',
      workspaceId,
      branchName,
      workspacePaneRoute: workspacePaneStaticRouteFromTabKey(childRoute.tabKey),
    }
  }
  if (childRoute.newWorktree) return { kind: 'newWorktree', workspaceId }
  if (childRoute.dashboard) return { kind: 'dashboard', workspaceId }
  if (childRoute.workspaceRoot) {
    return {
      kind: 'workspace-root',
      workspaceId,
      workspacePaneRoute: workspacePaneRouteFromParams(
        childRoute.workspaceRootTerminalSessionId,
        childRoute.workspaceRootTabKey,
      ),
    }
  }
  return { kind: 'empty', workspaceId }
}

function workspacePaneStaticRouteFromTabKey(tabKey: string | null | undefined): ParsedBranchWorkspacePaneRouteTarget {
  if (!tabKey) return null
  if (isWorkspacePaneStaticTabType(tabKey)) return { kind: 'static', tab: tabKey }
  return { kind: 'invalid-static', tabKey }
}

function workspacePaneRouteFromParams(
  terminalSessionId: string | null | undefined,
  tabKey: string | null | undefined,
): ParsedWorkspacePaneRoute | null {
  if (terminalSessionId) return { kind: 'terminal', terminalSessionId }
  if (!tabKey) return null
  if (isWorkspacePaneStaticTabType(tabKey)) return { kind: 'static', tab: tabKey }
  return { kind: 'invalid-static', tabKey }
}

export function routeStringParam(value: string | string[]): string | null {
  return typeof value === 'string' ? value : null
}
