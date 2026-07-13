import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export const WORKSPACE_PANE_TABS_SOCKET_ACTIONS = {
  list: 'workspace-pane-tabs.list',
  replace: 'workspace-pane-tabs.replace',
  update: 'workspace-pane-tabs.update',
} as const

export type WorkspacePaneTabsSocketAction =
  (typeof WORKSPACE_PANE_TABS_SOCKET_ACTIONS)[keyof typeof WORKSPACE_PANE_TABS_SOCKET_ACTIONS]

export function isWorkspacePaneTabsSocketAction(value: unknown): value is WorkspacePaneTabsSocketAction {
  return (
    typeof value === 'string' &&
    (Object.values(WORKSPACE_PANE_TABS_SOCKET_ACTIONS) as readonly string[]).includes(value)
  )
}

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
  repoRuntimeId: string
}

export interface WorkspacePaneTabsReplaceInput extends WorkspacePaneTabsTarget, WorkspacePaneTabsListInput {
  tabs: WorkspacePaneTabEntry[]
}

export interface WorkspacePaneTabsBatchReplaceInput {
  replacements: WorkspacePaneTabsReplaceInput[]
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

/**
 * Full canonical projection for one server workspace-tab scope.
 *
 * `revision` is allocated by the server and advances whenever any target in
 * the scope changes. Returning the full scope lets clients reject an older
 * response without losing changes to a different target that committed in
 * between two requests.
 */
export interface WorkspacePaneTabsSnapshot {
  revision: number
  entries: WorkspacePaneTabsEntry[]
}

export interface WorkspacePaneTabsSocketRequestInputs {
  'workspace-pane-tabs.list': WorkspacePaneTabsListInput
  'workspace-pane-tabs.replace': WorkspacePaneTabsReplaceInput
  'workspace-pane-tabs.update': WorkspacePaneTabsUpdateInput
}

export interface WorkspacePaneTabsSocketResponseOutputs {
  'workspace-pane-tabs.list': WorkspacePaneTabsSnapshot
  'workspace-pane-tabs.replace': WorkspacePaneTabsSnapshot
  'workspace-pane-tabs.update': WorkspacePaneTabsSnapshot
}
