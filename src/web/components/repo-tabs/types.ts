import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoLifecycle } from '#/shared/remote-repo.ts'
export interface RepoTabSummary {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  /**
   * Single source-of-truth lifecycle for a remote repo tab. `null`
   * for local repos. The tab UI reads `lifecycle.kind` directly
   * to decide which badge to show.
   */
  lifecycle: RemoteRepoLifecycle | null
}

export interface RepoTabStripLabels {
  repositories: string
  closeWithName: (name: string) => string
  more: string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  openRemote: string
  openRemoteShortcut: string | null
  clone: string
  cloneShortcut: string | null
  unavailable: string
}
