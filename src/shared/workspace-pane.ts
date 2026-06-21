export type WorkspacePaneStaticViewType = 'status' | 'changes' | 'history'
export type WorkspacePaneViewType = WorkspacePaneStaticViewType | 'terminal'
export type WorkspacePaneView = WorkspacePaneViewType
export type WorkspacePaneBranchViewType = Extract<WorkspacePaneStaticViewType, 'status' | 'history'>

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
