import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type {
  RepoWorkspaceMaterializedTab,
  RepoWorkspaceTab,
  RepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/tab-model.ts'

export type WorkspacePaneRouteReconciliation =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'replace'; route: RepoBranchWorkspacePaneRoute | null }

export type WorkspacePaneRouteHistoryResolution =
  { kind: 'defer' } | { kind: 'record'; route: RepoBranchWorkspacePaneRoute | null }

export function reconcileWorkspacePaneRoute(
  route: RepoBranchWorkspacePaneRoute | null,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  if (!route || !model.branchName) return { kind: 'none' }
  if (workspacePaneRouteReconciliationBlocked(model)) return { kind: 'pending' }
  if (route.kind === 'static') return reconcileStaticWorkspacePaneRoute(route, model)
  return reconcileTerminalWorkspacePaneRoute(route, model)
}

function workspacePaneRouteReconciliationBlocked(model: RepoWorkspaceTabModel): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function reconcileStaticWorkspacePaneRoute(
  route: Extract<RepoBranchWorkspacePaneRoute, { kind: 'static' }>,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  if (model.tabs.some((tab) => tab.kind === 'static' && tab.type === route.tab)) return { kind: 'none' }
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
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
  if (model.runtimeTabStateByType.terminal.projectionPhase === 'pending') return { kind: 'pending' }
  if (model.runtimeTabStateByType.terminal.projectionPhase === 'failed') return { kind: 'none' }
  return replacementForRoute(route, model)
}

export function workspacePaneRouteHistoryResolution(
  route: RepoBranchWorkspacePaneRoute | null,
  reconciliation: WorkspacePaneRouteReconciliation,
): WorkspacePaneRouteHistoryResolution {
  if (reconciliation.kind === 'pending') return { kind: 'defer' }
  if (reconciliation.kind === 'replace') return { kind: 'record', route: reconciliation.route }
  return { kind: 'record', route }
}

function replacementForRoute(
  route: RepoBranchWorkspacePaneRoute,
  model: RepoWorkspaceTabModel,
): WorkspacePaneRouteReconciliation {
  const fallbackRoute =
    routeForMaterializedTab(model.activeTab) ??
    routeForMaterializedTab(firstMaterializedTabForRoute(route, model.tabs)) ??
    routeForMaterializedTab(firstMaterializedTab(model.tabs))
  return fallbackRoute && workspacePaneRouteEquals(route, fallbackRoute)
    ? { kind: 'none' }
    : { kind: 'replace', route: fallbackRoute }
}

function firstMaterializedTabForRoute(
  route: RepoBranchWorkspacePaneRoute,
  tabs: readonly RepoWorkspaceTab[],
): RepoWorkspaceMaterializedTab | null {
  if (route.kind !== 'terminal') return null
  return (
    tabs.find((tab): tab is RepoWorkspaceMaterializedTab => tab.kind === 'runtime' && tab.runtimeType === 'terminal') ??
    null
  )
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
