import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoLifecycle } from '#/shared/remote-repo.ts'
export interface RepoPickerRepo {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  /**
   * Last time this client refreshed repo data after a sync/invalidation.
   * Null until snapshot/fetch resources have completed at least once.
   */
  lastSyncedAt: number | null
  /**
   * Single source-of-truth lifecycle for a remote repo. `null`
   * for local repos. The picker reads `lifecycle.kind` directly
   * to decide which badge to show on the current repo button.
   */
  lifecycle: RemoteRepoLifecycle | null
}

export interface RepoPickerLabels {
  repositories: string
  closeWithName: (name: string) => string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  openRemote: string
  openRemoteShortcut: string | null
  clone: string
  cloneShortcut: string | null
  unavailable: string
}
