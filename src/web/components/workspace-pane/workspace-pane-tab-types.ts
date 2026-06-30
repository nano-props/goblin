import type { LucideIcon } from 'lucide-react'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'

type TerminalWorkspacePaneTabSummary = Extract<WorkspacePaneTabSummary, { type: 'terminal' }>

type WorkspacePaneTabKind = 'static' | 'terminal' | 'pending'

interface WorkspacePaneTabItemBase {
  identity: string
  type: WorkspacePaneTabType
  kind: WorkspacePaneTabKind
  label: string
  tooltip: string
  icon: LucideIcon
  panelId?: string
}

interface WorkspacePaneSortableTabItemBase extends WorkspacePaneTabItemBase {
  closeLabel: string
  sortableId: string
  orderEntry: WorkspacePaneTabOrderEntry
}

export interface WorkspacePaneStaticTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'static'
  staticTabType: WorkspacePaneStaticTabType
  orderEntry: Extract<WorkspacePaneTabOrderEntry, { type: WorkspacePaneStaticTabType }>
}

export interface WorkspacePaneTerminalTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'terminal'
  view: TerminalWorkspacePaneTabSummary
  closeLabel: string
  orderEntry: Extract<WorkspacePaneTabOrderEntry, { type: 'terminal' }>
}

interface WorkspacePanePendingTabItem extends WorkspacePaneTabItemBase {
  kind: 'pending'
  busy: true
}

export type WorkspacePaneTabItem =
  WorkspacePaneStaticTabItem | WorkspacePaneTerminalTabItem | WorkspacePanePendingTabItem

export function createStaticWorkspacePaneTabItem(input: {
  type: WorkspacePaneStaticTabType
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneStaticTabItem {
  const provider = workspacePaneStaticTabProvider(input.type)
  return {
    identity: provider.identity(),
    type: input.type,
    kind: 'static',
    staticTabType: input.type,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: provider.icon,
    panelId: input.panelId,
    sortableId: provider.identity(),
    orderEntry: provider.orderEntry(),
  }
}

export function createTerminalWorkspacePaneTabItem(input: {
  view: TerminalWorkspacePaneTabSummary
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneTerminalTabItem {
  return {
    identity: terminalWorkspacePaneTabProvider.identity(input.view.terminalSessionId),
    type: input.view.type,
    kind: 'terminal',
    view: input.view,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: terminalWorkspacePaneTabProvider.icon,
    panelId: input.panelId,
    sortableId: terminalWorkspacePaneTabProvider.identity(input.view.terminalSessionId),
    orderEntry: terminalWorkspacePaneTabProvider.orderEntry(input.view.terminalSessionId),
  }
}

export function createPendingWorkspacePaneTabItem(input: {
  type: WorkspacePaneTabType
  label: string
  tooltip: string
  panelId?: string
}): WorkspacePanePendingTabItem {
  const identity = input.type === 'terminal' ? PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY : `${input.type}:pending`
  return {
    identity,
    type: input.type,
    kind: 'pending',
    label: input.label,
    tooltip: input.tooltip,
    icon: workspacePaneTabProvider(input.type).icon,
    panelId: input.panelId,
    busy: true,
  }
}

export function isStaticWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneStaticTabItem {
  return item.kind === 'static'
}

export function isTerminalWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneTerminalTabItem {
  return item.kind === 'terminal' && item.view.type === 'terminal'
}

export function isPendingWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePanePendingTabItem {
  return item.kind === 'pending'
}
