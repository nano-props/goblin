import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface GitBackgroundSyncTarget {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}
