import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoConnectionLifecycle } from '#/shared/remote-repo.ts'
export interface WorkspacePickerItem {
  id: string
  name: string
  /** Git capability reported by the authoritative workspace probe. */
  gitCapability: 'unknown' | 'available' | 'unavailable'
  git: {
    remoteDetails: GitRemoteInfo[] | undefined
    /** Last time this client refreshed Git data after a sync/invalidation. */
    lastSyncedAt: number | null
  } | null
  /** Unread terminal bell count across this workspace's terminal sessions. */
  terminalBellCount?: number
  /**
   * Single source-of-truth lifecycle for a remote workspace. `null`
   * for local workspaces. The picker reads `lifecycle.kind` directly
   * to decide which badge to show on the current workspace button.
   */
  lifecycle: RemoteRepoConnectionLifecycle | null
}

export type WorkspacePickerSurface = 'toolbar' | 'sidebar'

export interface WorkspacePickerLabels {
  workspaces: string
  closeWithName: (name: string) => string
  open: string
  placeholder: string
  openLocal: string
  openLocalShortcut: string | null
  openRemote: string
  openRemoteShortcut: string | null
  clone: string
  cloneShortcut: string | null
  unavailable: string
}
