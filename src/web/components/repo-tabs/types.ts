import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
import type { RepoConnectivity } from '#/web/stores/repos/types.ts'
export interface RepoTabSummary {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  remoteTarget?: RemoteRepoTarget
  unavailable?: boolean
  /** Live SSH liveness state for remote tabs. Drives the connecting
   *  spinner; ignored for local tabs. */
  connectivity: RepoConnectivity
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
