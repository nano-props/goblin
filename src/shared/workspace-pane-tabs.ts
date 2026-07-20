import type {
  WorkspacePaneStaticTabEntry,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import type { RestorableWorkspacePaneTarget, RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

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

export interface WorkspacePaneTabsInvalidatedRealtimeMessage {
  type: typeof WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed
  change: 'invalidation'
  workspaceId: WorkspaceId
}

export interface WorkspacePaneTabsRevisionRealtimeMessage {
  type: typeof WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed
  change: 'revision'
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  revision: number
}

export type WorkspacePaneTabsChangedRealtimeMessage =
  WorkspacePaneTabsInvalidatedRealtimeMessage | WorkspacePaneTabsRevisionRealtimeMessage

export type WorkspacePaneTabsRealtimeMessage = WorkspacePaneTabsChangedRealtimeMessage

export function workspacePaneTabsInvalidatedRealtimeMessage(
  workspaceId: WorkspaceId,
): WorkspacePaneTabsInvalidatedRealtimeMessage {
  return { type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed, change: 'invalidation', workspaceId }
}

export function workspacePaneTabsRevisionRealtimeMessage(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  revision: number,
): WorkspacePaneTabsRevisionRealtimeMessage {
  return {
    type: WORKSPACE_PANE_TABS_REALTIME_EVENTS.changed,
    change: 'revision',
    workspaceId,
    workspaceRuntimeId,
    revision,
  }
}

export interface WorkspacePaneTabsListInput {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

export interface WorkspacePaneTabsReplaceInput extends WorkspacePaneTabsListInput {
  target: RuntimeWorkspacePaneTarget
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

export interface WorkspacePaneTabsUpdateInput extends WorkspacePaneTabsListInput {
  target: RuntimeWorkspacePaneTarget
  operation: WorkspacePaneTabsUpdateOperation
}

export interface WorkspacePaneTabsEntry {
  target: RuntimeWorkspacePaneTarget
  tabs: WorkspacePaneTabEntry[]
}

export interface WorkspacePaneDurableLayoutEntry {
  target: RestorableWorkspacePaneTarget
  tabs: WorkspacePaneStaticTabEntry[]
}

/** Restart-durable layout intent. Live runtime sessions are projection-only. */
export interface WorkspacePaneDurableLayout {
  entries: WorkspacePaneDurableLayoutEntry[]
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
