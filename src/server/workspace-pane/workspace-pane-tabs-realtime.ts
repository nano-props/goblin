import {
  workspacePaneTabsInvalidatedRealtimeMessage,
  workspacePaneTabsRevisionRealtimeMessage,
  type WorkspacePaneTabsRealtimeMessage,
} from '#/shared/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsRealtimeBroadcaster {
  broadcastToUser(userId: string, message: WorkspacePaneTabsRealtimeMessage): void
}

export function broadcastWorkspacePaneTabsChanged(
  broadcaster: WorkspacePaneTabsRealtimeBroadcaster,
  userId: string,
  workspaceId: string,
): void {
  broadcaster.broadcastToUser(userId, workspacePaneTabsInvalidatedRealtimeMessage(workspaceId))
}

export function broadcastWorkspacePaneTabsRevision(
  broadcaster: WorkspacePaneTabsRealtimeBroadcaster,
  userId: string,
  workspaceId: string,
  workspaceRuntimeId: string,
  revision: number,
): void {
  broadcaster.broadcastToUser(userId, workspacePaneTabsRevisionRealtimeMessage(workspaceId, workspaceRuntimeId, revision))
}
