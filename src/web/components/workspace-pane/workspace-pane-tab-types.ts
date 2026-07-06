import type { LucideIcon } from 'lucide-react'
import type {
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabSummary } from '#/web/components/terminal/types.ts'
import {
  agentWorkspacePaneTabProvider,
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  workspacePaneTabProvider,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { PENDING_TERMINAL_WORKSPACE_PANE_TAB_IDENTITY } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'

type TerminalWorkspacePaneTabSummary = Extract<WorkspacePaneTabSummary, { type: 'terminal' }>
type AgentWorkspacePaneTabSummary = Extract<WorkspacePaneTabSummary, { type: 'agent' }>

type WorkspacePaneTabKind = 'static' | 'terminal' | 'agent' | 'pending'

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
  tabEntry: WorkspacePaneTabEntry
}

export interface WorkspacePaneStaticTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'static'
  staticTabType: WorkspacePaneStaticTabType
  tabEntry: Extract<WorkspacePaneTabEntry, { type: WorkspacePaneStaticTabType }>
}

export interface WorkspacePaneTerminalTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'terminal'
  view: TerminalWorkspacePaneTabSummary
  closeLabel: string
  tabEntry: Extract<WorkspacePaneTabEntry, { type: 'terminal' }>
}

export interface WorkspacePaneAgentTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'agent'
  view: AgentWorkspacePaneTabSummary
  closeLabel: string
  tabEntry: Extract<WorkspacePaneTabEntry, { type: 'agent' }>
}

interface WorkspacePanePendingTabItem extends WorkspacePaneTabItemBase {
  kind: 'pending'
  busy: true
}

export type WorkspacePaneTabItem =
  | WorkspacePaneStaticTabItem
  | WorkspacePaneTerminalTabItem
  | WorkspacePaneAgentTabItem
  | WorkspacePanePendingTabItem

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
    tabEntry: provider.tabEntry(),
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
    tabEntry: terminalWorkspacePaneTabProvider.tabEntry(input.view.terminalSessionId),
  }
}

export function createAgentWorkspacePaneTabItem(input: {
  view: AgentWorkspacePaneTabSummary
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneAgentTabItem {
  return {
    identity: agentWorkspacePaneTabProvider.identity(input.view.agentSessionId),
    type: input.view.type,
    kind: 'agent',
    view: input.view,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: agentWorkspacePaneTabProvider.icon,
    panelId: input.panelId,
    sortableId: agentWorkspacePaneTabProvider.identity(input.view.agentSessionId),
    tabEntry: agentWorkspacePaneTabProvider.tabEntry(input.view.agentSessionId),
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

export function isAgentWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneAgentTabItem {
  return item.kind === 'agent' && item.view.type === 'agent'
}

export function isPendingWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePanePendingTabItem {
  return item.kind === 'pending'
}
