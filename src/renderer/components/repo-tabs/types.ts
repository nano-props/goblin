import type { GitRemoteInfo } from '#/renderer/types.ts'

export interface RepoTabSummary {
  id: string
  name: string
  remoteDetails: GitRemoteInfo[]
  unavailable?: boolean
}

export interface RepoTabStripLabels {
  repositories: string
  close: string
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
