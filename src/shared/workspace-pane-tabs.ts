import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export const WORKSPACE_PANE_TABS_SOCKET_ACTIONS = {
  list: 'workspace-pane-tabs.list',
  replace: 'workspace-pane-tabs.replace',
  update: 'workspace-pane-tabs.update',
} as const

export type WorkspacePaneTabsSocketAction =
  (typeof WORKSPACE_PANE_TABS_SOCKET_ACTIONS)[keyof typeof WORKSPACE_PANE_TABS_SOCKET_ACTIONS]

export const WORKSPACE_PANE_TABS_REALTIME_EVENTS = {
  changed: 'workspace-pane-tabs.changed',
} as const

export interface WorkspacePaneTabsChangedRealtimeMessage {
  type: typeof WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed
  repoRoot: string
}

export type WorkspacePaneTabsRealtimeMessage = WorkspacePaneTabsChangedRealtimeMessage

export function workspacePaneTabsChangedRealtimeMessage(repoRoot: string): WorkspacePaneTabsChangedRealtimeMessage {
  return { type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed, repoRoot }
}

export interface WorkspacePaneTabsListInput {
  repoRoot: string
  repoInstanceId: string
}

export interface WorkspacePaneTabsReplaceInput extends WorkspacePaneTabsTarget, WorkspacePaneTabsListInput {
  tabs: WorkspacePaneTabEntry[]
}

export type WorkspacePaneTabsUpdateOperation =
  | {
      type: 'open-static'
      tabType: WorkspacePaneStaticTabType
      insertAfterIdentity?: string | null
    }
  | { type: 'close-static'; tabType: WorkspacePaneStaticTabType }
  | { type: 'reorder'; tabIdentities: string[] }

export interface WorkspacePaneTabsUpdateInput extends WorkspacePaneTabsTarget, WorkspacePaneTabsListInput {
  operation: WorkspacePaneTabsUpdateOperation
}

export interface WorkspacePaneTabsEntry extends WorkspacePaneTabsTarget {
  tabs: WorkspacePaneTabEntry[]
}
