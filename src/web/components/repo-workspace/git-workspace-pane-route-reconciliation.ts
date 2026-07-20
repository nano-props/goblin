import type { ParsedWorkspacePaneRoute, ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import { WORKSPACE_PANE_RUNTIME_TAB_TYPES } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'

export type GitWorkspacePaneRouteReconciliation =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'unverified' } | { kind: 'replace-empty-pane' }

export type GitWorkspacePaneRouteHistoryResolution =
  { kind: 'defer' } | { kind: 'record'; route: WorkspacePaneRouteTarget }

export function reconcileGitWorkspacePaneRoute(
  route: ParsedWorkspacePaneRouteTarget,
  model: WorkspacePaneTabModel,
): GitWorkspacePaneRouteReconciliation {
  if (!route || !model.branchName) return { kind: 'none' }
  if (gitWorkspacePaneRouteReconciliationBlocked(model)) return { kind: 'pending' }
  if (route.kind === 'static') return reconcileStaticGitWorkspacePaneRoute(route, model)
  if (route.kind === 'invalid-static') return reconcileInvalidGitWorkspacePaneRoute(route, model)
  return reconcileTerminalGitWorkspacePaneRoute(route, model)
}

function gitWorkspacePaneRouteReconciliationBlocked(model: WorkspacePaneTabModel): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_TYPES.some((type) => model.runtimeTabStateByType[type].createPending)
}

function reconcileStaticGitWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'static' }>,
  model: WorkspacePaneTabModel,
): GitWorkspacePaneRouteReconciliation {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  if (model.tabs.some((tab) => tab.kind === 'static' && tab.type === route.tab)) return { kind: 'none' }
  return replaceWithEmptyPaneRoute()
}

function reconcileTerminalGitWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'terminal' }>,
  model: WorkspacePaneTabModel,
): GitWorkspacePaneRouteReconciliation {
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

function reconcileInvalidGitWorkspacePaneRoute(
  route: Extract<ParsedWorkspacePaneRoute, { kind: 'invalid-static' }>,
  model: WorkspacePaneTabModel,
): GitWorkspacePaneRouteReconciliation {
  if (model.tabEntriesProjectionPhase === 'pending') return { kind: 'pending' }
  if (model.tabEntriesProjectionPhase === 'failed') return { kind: 'unverified' }
  return replaceWithEmptyPaneRoute()
}

export function gitWorkspacePaneRouteHistoryResolution(
  route: ParsedWorkspacePaneRouteTarget,
  reconciliation: GitWorkspacePaneRouteReconciliation,
): GitWorkspacePaneRouteHistoryResolution {
  if (reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') return { kind: 'defer' }
  if (reconciliation.kind === 'replace-empty-pane') return { kind: 'record', route: null }
  if (route?.kind === 'invalid-static') return { kind: 'record', route: null }
  return { kind: 'record', route }
}

function replaceWithEmptyPaneRoute(): GitWorkspacePaneRouteReconciliation {
  return { kind: 'replace-empty-pane' }
}
