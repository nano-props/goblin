import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoLifecycle } from '#/shared/remote-repo.ts'
export interface RepoTabSummary {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  /**
   * Single source-of-truth lifecycle for a remote repo tab. `null`
   * for local repos. The tab UI reads `lifecycle.kind` directly
   * to decide which badge to show. The legacy `unavailable`
   * boolean and `remoteTarget` field were removed in Phase 4 of
   * the remote-repo refactor.
   */
  lifecycle: RemoteRepoLifecycle | null
  /**
   * Whether the repo is in a terminal "cannot be operated on"
   * state. Computed via `isRepoUnavailable(repo)`:
   *   - local repo: `availability.phase === 'unavailable'`
   *   - remote repo: `remote.lifecycle.kind === 'failed'`
   */
  unavailable: boolean
}

export interface RepoTabStripLabels {
  repositories: string
  closeWithName: (name: string) => string
  more: string
  dragToReorder: string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  openRemote: string
  openRemoteShortcut: string | null
  clone: string
  cloneShortcut: string | null
  unavailable: string
}
