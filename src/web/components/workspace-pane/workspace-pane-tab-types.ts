import type { LucideIcon } from 'lucide-react'
import type {
  WorkspacePaneRuntimeTabEntry,
  WorkspacePaneRuntimeTabType,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabAttention } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import {
  workspacePanePendingRuntimeTabIdentity,
  workspacePaneRuntimeTabSummaryIdentity,
  workspacePaneRuntimeTabSummarySessionId,
} from '#/web/workspace-pane/workspace-pane-tab-summary.ts'

type WorkspacePaneTabKind = 'static' | 'runtime' | 'pending'

interface WorkspacePaneTabItemBase {
  identity: string
  type: WorkspacePaneTabType
  kind: WorkspacePaneTabKind
  label: string
  tooltip: string
  icon: LucideIcon
  panelId?: string
  closable?: boolean
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

export interface WorkspacePaneRuntimeTabItem extends WorkspacePaneSortableTabItemBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'runtime'
  runtimeType: WorkspacePaneRuntimeTabType
  view: WorkspacePaneRuntimeTabSummary
  closeLabel: string
  tabEntry: WorkspacePaneRuntimeTabEntry
  attention: WorkspacePaneRuntimeTabAttention['attention']
  attentionLabelKey?: WorkspacePaneRuntimeTabAttention['attentionLabelKey']
}

interface WorkspacePanePendingTabItem extends WorkspacePaneTabItemBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'pending'
  busy: true
}

export type WorkspacePaneTabItem =
  WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem | WorkspacePanePendingTabItem

export function createStaticWorkspacePaneTabItem(input: {
  type: WorkspacePaneStaticTabType
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
  closable?: boolean
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
    closable: input.closable,
    sortableId: provider.identity(),
    tabEntry: provider.tabEntry(),
  }
}

export function createRuntimeWorkspacePaneTabItem(input: {
  view: WorkspacePaneRuntimeTabSummary
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneRuntimeTabItem {
  const type = input.view.type
  const provider = workspacePaneRuntimeTabProvider(type)
  const sessionId = workspacePaneRuntimeTabSummarySessionId(input.view)
  const identity = workspacePaneRuntimeTabSummaryIdentity(input.view)
  return {
    identity,
    type,
    kind: 'runtime',
    runtimeType: type,
    view: input.view,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: provider.icon,
    panelId: input.panelId,
    sortableId: identity,
    tabEntry: provider.tabEntry(sessionId),
    ...provider.attention({ view: input.view }),
  }
}

export function createPendingWorkspacePaneTabItem(input: {
  type: WorkspacePaneRuntimeTabType
  label: string
  tooltip: string
  panelId?: string
}): WorkspacePanePendingTabItem {
  return {
    identity: workspacePanePendingRuntimeTabIdentity(input.type),
    type: input.type,
    kind: 'pending',
    label: input.label,
    tooltip: input.tooltip,
    icon: workspacePaneRuntimeTabProvider(input.type).icon,
    panelId: input.panelId,
    busy: true,
  }
}

export function isStaticWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneStaticTabItem {
  return item.kind === 'static'
}

export function isRuntimeWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneRuntimeTabItem {
  return item.kind === 'runtime'
}

export function isPendingWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePanePendingTabItem {
  return item.kind === 'pending'
}
