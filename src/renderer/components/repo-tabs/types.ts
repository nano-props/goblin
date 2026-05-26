export interface RepoTabSummary {
  id: string
  name: string
  unavailable?: boolean
}

export interface RepoTabStripLabels {
  repositories: string
  close: string
  dragToReorder: string
  open: string
  openLocal: string
  openLocalShortcut: string | null
  clone: string
  cloneShortcut: string | null
  unavailable: string
}
