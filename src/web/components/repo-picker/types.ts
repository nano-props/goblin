import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoConnectionLifecycle } from '#/shared/remote-repo.ts'
export interface RepoPickerRepo {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  /**
   * Last time this client refreshed repo data after a sync/invalidation.
   * Null until read-model/fetch data loads have completed at least once.
   */
  lastSyncedAt: number | null
  /** Unread terminal bell count across this repo's terminal sessions. */
  terminalBellCount?: number
  /**
   * Single source-of-truth lifecycle for a remote repo. `null`
   * for local repos. The picker reads `lifecycle.kind` directly
   * to decide which badge to show on the current repo button.
   */
  lifecycle: RemoteRepoConnectionLifecycle | null
}

export type RepoPickerSurface = 'toolbar' | 'sidebar'

export interface RepoPickerLabels {
  repositories: string
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
