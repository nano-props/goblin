import type { ParsedWorkspacePaneRoute, ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'

export type WorkspacePaneRouteReconciliation =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'unverified' } | { kind: 'missing' }

export type WorkspacePaneRouteHistoryResolution =
  { kind: 'defer' } | { kind: 'record'; route: WorkspacePaneRouteTarget }

export function reconcileWorkspacePaneRoute(
  route: ParsedWorkspacePaneRouteTarget,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  if (!route) return { kind: 'none' }
  if (workspacePaneRouteReconciliationBlocked(model)) return { kind: 'pending' }
  if (route.kind === 'static') return reconcileStaticWorkspacePaneRoute(route, model)
  if (route.kind === 'invalid-static') return reconcileInvalidWorkspacePaneRoute(model)
  return reconcileTerminalWorkspacePaneRoute(route, model)
}

export function workspacePaneRouteHistoryResolution(
  route: ParsedWorkspacePaneRouteTarget,
  reconciliation: WorkspacePaneRouteReconciliation,
): WorkspacePaneRouteHistoryResolution {
  if (reconciliation.kind !== 'none' || route?.kind === 'invalid-static') return { kind: 'defer' }
  return { kind: 'record', route }
}

function workspacePaneRouteReconciliationBlocked(model: WorkspacePaneTabModel): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function reconcileStaticWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'static' }>,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  const projectionState = tabEntriesProjectionReconciliation(model)
  if (projectionState) return projectionState
  if (model.tabs.some((tab) => tab.kind === 'static' && tab.type === route.tab)) return { kind: 'none' }
  return { kind: 'missing' }
}

function reconcileTerminalWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'terminal' }>,
  model: WorkspacePaneTabModel,
): WorkspacePaneRouteReconciliation {
  const tabEntriesState = tabEntriesProjectionReconciliation(model)
  if (tabEntriesState) return tabEntriesState
  const terminalProjectionPhase = model.runtimeTabStateByType.terminal.projectionPhase
  if (terminalProjectionPhase === 'pending') return { kind: 'pending' }
  if (terminalProjectionPhase === 'failed') return { kind: 'unverified' }
  if (
    model.tabs.some(
      (tab) => tab.kind === 'runtime' && tab.runtimeType === 'terminal' && tab.sessionId === route.terminalSessionId,
    )
  ) {
    return { kind: 'none' }
  }
  return { kind: 'missing' }
}

function reconcileInvalidWorkspacePaneRoute(model: WorkspacePaneTabModel): WorkspacePaneRouteReconciliation {
  return tabEntriesProjectionReconciliation(model) ?? { kind: 'missing' }
}

function tabEntriesProjectionReconciliation(
  model: WorkspacePaneTabModel,
): Extract<WorkspacePaneRouteReconciliation, { kind: 'pending' | 'unverified' }> | null {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  return null
}
