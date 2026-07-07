import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type {
  RepoWorkspaceMaterializedTab,
  RepoWorkspaceTab,
  RepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/tab-model.ts'

export type WorkspacePaneRouteReconciliation =
  | { kind: 'none' }
  | { kind: 'replace'; route: RepoBranchWorkspacePaneRoute }

export function reconcileWorkspacePaneRoute(
  route: RepoBranchWorkspacePaneRoute | null,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  if (!route || !model.branchName) return { kind: 'none' }
  if (route.kind === 'static') return reconcileStaticWorkspacePaneRoute(route, model)
  return reconcileTerminalWorkspacePaneRoute(route, model)
}

function reconcileStaticWorkspacePaneRoute(
  route: Extract<RepoBranchWorkspacePaneRoute, { kind: 'static' }>,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  if (model.tabs.some((tab) => tab.kind === 'static' && tab.type === route.tab)) return { kind: 'none' }
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'none' }
  return replacementForRoute(route, model)
}

function reconcileTerminalWorkspacePaneRoute(
  route: Extract<RepoBranchWorkspacePaneRoute, { kind: 'terminal' }>,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  if (
    model.tabs.some(
      (tab) => tab.kind === 'runtime' && tab.runtimeType === 'terminal' && tab.sessionId === route.terminalSessionId,
    )
  ) {
    return { kind: 'none' }
  }
  if (model.runtimeTabStateByType.terminal.projectionPhase === 'pending') return { kind: 'none' }
  return replacementForRoute(route, model)
}

function replacementForRoute(
  route: RepoBranchWorkspacePaneRoute,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  const fallbackRoute = routeForMaterializedTab(model.activeTab) ?? routeForMaterializedTab(firstMaterializedTab(model.tabs)) ?? {
    kind: 'static',
    tab: 'status',
  }
  return workspacePaneRouteEquals(route, fallbackRoute) ? { kind: 'none' } : { kind: 'replace', route: fallbackRoute }
}

function firstMaterializedTab(tabs: readonly RepoWorkspaceTab[]): RepoWorkspaceMaterializedTab | null {
  return tabs.find((tab): tab is RepoWorkspaceMaterializedTab => tab.kind !== 'pending') ?? null
}

function routeForMaterializedTab(tab: RepoWorkspaceMaterializedTab | null): RepoBranchWorkspacePaneRoute | null {
  if (!tab) return null
  if (tab.kind === 'static') return { kind: 'static', tab: tab.type }
  if (tab.runtimeType === 'terminal') return { kind: 'terminal', terminalSessionId: tab.sessionId }
  return null
}

function workspacePaneRouteEquals(a: RepoBranchWorkspacePaneRoute, b: RepoBranchWorkspacePaneRoute): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'static' && b.kind === 'static') return a.tab === b.tab
  if (a.kind === 'terminal' && b.kind === 'terminal') return a.terminalSessionId === b.terminalSessionId
  return false
}
