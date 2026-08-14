import type { LucideIcon } from '@lucide/vue'
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

type WorkspacePaneTabKind = 'static' | 'runtime' | 'runtime-placeholder' | 'pending'

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

interface WorkspacePaneOrderedTabItemBase extends WorkspacePaneTabItemBase {
  sortableId: string
  tabEntry: WorkspacePaneTabEntry
}

interface WorkspacePaneClosableTabItemBase extends WorkspacePaneOrderedTabItemBase {
  closeLabel: string
}

export interface WorkspacePaneStaticTabItem extends WorkspacePaneClosableTabItemBase {
  kind: 'static'
  staticTabType: WorkspacePaneStaticTabType
  tabEntry: Extract<WorkspacePaneTabEntry, { type: WorkspacePaneStaticTabType }>
}

export interface WorkspacePaneRuntimeTabItem extends WorkspacePaneClosableTabItemBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'runtime'
  runtimeType: WorkspacePaneRuntimeTabType
  view: WorkspacePaneRuntimeTabSummary
  closeLabel: string
  tabEntry: WorkspacePaneRuntimeTabEntry
  attention: WorkspacePaneRuntimeTabAttention['attention']
  attentionLabelKey?: WorkspacePaneRuntimeTabAttention['attentionLabelKey']
}

export interface WorkspacePaneRuntimePlaceholderTabItem extends WorkspacePaneOrderedTabItemBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'runtime-placeholder'
  runtimeType: WorkspacePaneRuntimeTabType
  tabEntry: WorkspacePaneRuntimeTabEntry
  closable: false
  busy: boolean
}

interface WorkspacePanePendingTabItem extends WorkspacePaneTabItemBase {
  type: WorkspacePaneRuntimeTabType
  kind: 'pending'
  busy: true
}

export type WorkspacePaneTabItem =
  | WorkspacePaneStaticTabItem
  | WorkspacePaneRuntimeTabItem
  | WorkspacePaneRuntimePlaceholderTabItem
  | WorkspacePanePendingTabItem

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

export function createRuntimePlaceholderWorkspacePaneTabItem(input: {
  tabEntry: WorkspacePaneRuntimeTabEntry
  label: string
  busy: boolean
  panelId?: string
}): WorkspacePaneRuntimePlaceholderTabItem {
  const provider = workspacePaneRuntimeTabProvider(input.tabEntry.type)
  const sessionId = input.tabEntry.runtimeSessionId
  const identity = provider.identity(sessionId)
  return {
    identity,
    type: input.tabEntry.type,
    kind: 'runtime-placeholder',
    runtimeType: input.tabEntry.type,
    label: input.label,
    tooltip: input.label,
    icon: provider.icon,
    panelId: input.panelId,
    closable: false,
    busy: input.busy,
    sortableId: identity,
    tabEntry: input.tabEntry,
  }
}

export function isStaticWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneStaticTabItem {
  return item.kind === 'static'
}

export function isRuntimeWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneRuntimeTabItem {
  return item.kind === 'runtime'
}

export function isRuntimePlaceholderWorkspacePaneTabItem(
  item: WorkspacePaneTabItem,
): item is WorkspacePaneRuntimePlaceholderTabItem {
  return item.kind === 'runtime-placeholder'
}

export function isPendingWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePanePendingTabItem {
  return item.kind === 'pending'
}
