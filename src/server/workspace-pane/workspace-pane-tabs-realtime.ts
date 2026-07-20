import {
  workspacePaneTabsInvalidatedRealtimeMessage,
  workspacePaneTabsRevisionRealtimeMessage,
  type WorkspacePaneTabsRealtimeMessage,
} from '#/shared/workspace-pane-tabs.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface WorkspacePaneTabsRealtimeBroadcaster {
  broadcastToUser(userId: string, message: WorkspacePaneTabsRealtimeMessage): void
}

export function broadcastWorkspacePaneTabsChanged(
  broadcaster: WorkspacePaneTabsRealtimeBroadcaster,
  userId: string,
  workspaceId: WorkspaceId,
): void {
  broadcaster.broadcastToUser(userId, workspacePaneTabsInvalidatedRealtimeMessage(workspaceId))
}

export function broadcastWorkspacePaneTabsRevision(
  broadcaster: WorkspacePaneTabsRealtimeBroadcaster,
  userId: string,
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  revision: number,
): void {
  broadcaster.broadcastToUser(userId, workspacePaneTabsRevisionRealtimeMessage(workspaceId, workspaceRuntimeId, revision))
}
