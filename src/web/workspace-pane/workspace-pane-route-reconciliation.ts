import type { ParsedWorkspacePaneRoute, ParsedWorkspacePaneRouteTarget, WorkspacePaneRouteTarget } from '#/web/App.tsx'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  WORKSPACE_PANE_RUNTIME_TAB_TYPES,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import {
  type WorkspacePaneMaterializedTab,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'

export type WorkspacePaneRouteReconciliation =
  { kind: 'none' } | { kind: 'pending' } | { kind: 'unverified' } | { kind: 'missing' }

export type WorkspacePaneRouteHistoryResolution =
  { kind: 'defer' } | { kind: 'record'; route: WorkspacePaneRouteTarget }

export type FilesystemWorkspacePaneReplacementResolution =
  { kind: 'pending' } | { kind: 'unverified' } | { kind: 'resolved'; replacement: WorkspacePaneMaterializedTab | null }

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

export function resolveFilesystemWorkspacePaneReplacement(
  model: WorkspacePaneTabModel,
): FilesystemWorkspacePaneReplacementResolution {
  const tabEntriesState = tabEntriesProjectionReconciliation(model)
  if (tabEntriesState) return tabEntriesState
  const entries = orderedReplacementEntries(model)
  for (const entry of entries) {
    if (isWorkspacePaneRuntimeTabEntry(entry)) {
      const phase = model.runtimeTabStateByType[entry.type].projectionPhase
      if (phase === 'pending') return { kind: 'pending' }
      if (phase === 'failed') return { kind: 'unverified' }
    }
    const identity = workspacePaneTabEntryIdentity(entry)
    const materialized = model.tabs.find(
      (tab): tab is WorkspacePaneMaterializedTab => tab.kind !== 'pending' && tab.identity === identity,
    )
    if (materialized) return { kind: 'resolved', replacement: materialized }
  }
  return { kind: 'resolved', replacement: null }
}

function orderedReplacementEntries(model: WorkspacePaneTabModel): WorkspacePaneTabEntry[] {
  const selectedTerminalSessionId = model.runtimeTabStateByType.terminal.selectedSessionId
  const selectedTerminalEntry = selectedTerminalSessionId
    ? model.tabEntries.find(
        (entry) =>
          isWorkspacePaneRuntimeTabEntry(entry) &&
          entry.type === 'terminal' &&
          entry.runtimeSessionId === selectedTerminalSessionId,
      )
    : null
  if (!selectedTerminalEntry) return model.tabEntries
  return [
    selectedTerminalEntry,
    ...model.tabEntries.filter(
      (entry) => workspacePaneTabEntryIdentity(entry) !== workspacePaneTabEntryIdentity(selectedTerminalEntry),
    ),
  ]
}

export function workspacePaneRouteHistoryResolution(
  route: ParsedWorkspacePaneRouteTarget,
  reconciliation: WorkspacePaneRouteReconciliation,
): WorkspacePaneRouteHistoryResolution {
  if (reconciliation.kind === 'pending' || reconciliation.kind === 'unverified') return { kind: 'defer' }
  if (reconciliation.kind === 'missing') return { kind: 'record', route: null }
  if (route?.kind === 'invalid-static') return { kind: 'record', route: null }
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
