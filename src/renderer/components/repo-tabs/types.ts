export interface RepoTabSummary {
  id: string
  name: string
  currentBranch: string
}

export interface RepoTabStripLabels {
  repositories: string
  emptyBefore: string
  emptyOpenLabel: string
  emptyAfter: string
  close: string
  dragToReorder: string
  open: string
  missingTitle: string
  missingDismiss: string
}
