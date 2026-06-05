import type { GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
export interface RepoTabSummary {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  remoteTarget?: RemoteRepoTarget
  unavailable?: boolean
}

export interface RepoTabStripLabels {
  repositories: string
  close: string
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
