import type { ParsedWorkspacePaneRoute, ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'

export type WorkspacePaneRouteReconciliation =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'unverified' } | { kind: 'replace-empty-pane' }

export type WorkspacePaneRouteHistoryResolution =
  { kind: 'defer' } | { kind: 'record'; route: WorkspacePaneRouteTarget }

export function reconcileWorkspacePaneRoute(
  route: ParsedWorkspacePaneRouteTarget,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  if (!route || !model.branchName) return { kind: 'none' }
  if (workspacePaneRouteReconciliationBlocked(model)) return { kind: 'pending' }
  if (route.kind === 'static') return reconcileStaticWorkspacePaneRoute(route, model)
  if (route.kind === 'invalid-static') return reconcileInvalidWorkspacePaneRoute(route, model)
  return reconcileTerminalWorkspacePaneRoute(route, model)
}

function workspacePaneRouteReconciliationBlocked(model: WorkspacePaneTabModel): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function reconcileStaticWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'static' }>,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  if (model.tabs.some((tab) => tab.kind === 'static' && tab.type === route.tab)) return { kind: 'none' }
  return replaceWithEmptyPaneRoute()
}

function reconcileTerminalWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'terminal' }>,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  if (model.runtimeTabStateByType.terminal.projectionPhase === 'pending') return { kind: 'pending' }
  if (model.runtimeTabStateByType.terminal.projectionPhase === 'failed') return { kind: 'unverified' }
  if (
    model.tabs.some(
      (tab) => tab.kind === 'runtime' && tab.runtimeType === 'terminal' && tab.sessionId === route.terminalSessionId,
    )
  ) {
    return { kind: 'none' }
  }
  return replaceWithEmptyPaneRoute()
}

function reconcileInvalidWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'invalid-static' }>,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  return replaceWithEmptyPaneRoute()
}

export function workspacePaneRouteHistoryResolution(
  route: ParsedWorkspacePaneRouteTarget,
  reconciliation: WorkspacePaneRouteReconciliation,
): WorkspacePaneRouteHistoryResolution {
  if (reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') return { kind: 'defer' }
  if (reconciliation.kind === 'replace-empty-pane') return { kind: 'record', route: null }
  if (route?.kind === 'invalid-static') return { kind: 'record', route: null }
  return { kind: 'record', route }
}

function replaceWithEmptyPaneRoute(): WorkspacePaneRouteReconciliation {
  return { kind: 'replace-empty-pane' }
}
