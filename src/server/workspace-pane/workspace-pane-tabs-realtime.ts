import {
  workspacePaneTabsChangedRealtimeMessage,
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
  broadcaster.broadcastToUser(userId, workspacePaneTabsChangedRealtimeMessage(repoRoot))
}
