export type WorkspacePaneBranchViewType = 'status'
export type WorkspacePaneStaticViewType = 'changes'
export type WorkspacePaneViewType = WorkspacePaneBranchViewType | WorkspacePaneStaticViewType | 'terminal'
export type WorkspacePaneView = WorkspacePaneViewType

export interface WorkspacePaneViewOrderEntry {
  type: WorkspacePaneViewType
  id: string
}

export interface WorkspacePaneStaticViewSummary {
  type: WorkspacePaneStaticViewType
  id: string
  worktreePath: string
  displayOrder: number
}

export interface WorkspacePaneListViewsInput {
  repoRoot: string
}

export interface WorkspacePaneStaticViewInput {
  repoRoot: string
  worktreePath: string
  type: WorkspacePaneStaticViewType
}

export interface WorkspacePaneReorderInput {
  repoRoot: string
  worktreePath: string
  orderedViews: WorkspacePaneViewOrderEntry[]
}
