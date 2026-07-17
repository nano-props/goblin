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
  repoRoot: string,
): void {
  broadcaster.broadcastToUser(userId, workspacePaneTabsInvalidatedRealtimeMessage(repoRoot))
}

export function broadcastWorkspacePaneTabsRevision(
  broadcaster: WorkspacePaneTabsRealtimeBroadcaster,
  userId: string,
  repoRoot: string,
  workspaceRuntimeId: string,
  revision: number,
): void {
  broadcaster.broadcastToUser(
    userId,
    workspacePaneTabsRevisionRealtimeMessage(repoRoot, workspaceRuntimeId, revision),
  )
}
