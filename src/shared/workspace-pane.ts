export const WORKSPACE_PANE_STATIC_VIEW_TYPES = ['status', 'changes', 'history'] as const
export const WORKSPACE_PANE_VIEW_TYPES = [...WORKSPACE_PANE_STATIC_VIEW_TYPES, 'terminal'] as const

export type WorkspacePaneStaticViewType = (typeof WORKSPACE_PANE_STATIC_VIEW_TYPES)[number]
export type WorkspacePaneViewType = (typeof WORKSPACE_PANE_VIEW_TYPES)[number]
export type WorkspacePaneView = WorkspacePaneViewType
export const WORKSPACE_PANE_BRANCH_VIEW_TYPES = ['status', 'history'] as const satisfies readonly WorkspacePaneStaticViewType[]
export type WorkspacePaneBranchViewType = (typeof WORKSPACE_PANE_BRANCH_VIEW_TYPES)[number]

export function isWorkspacePaneViewType(value: string | null | undefined): value is WorkspacePaneViewType {
  return typeof value === 'string' && (WORKSPACE_PANE_VIEW_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneStaticViewType(
  value: string | null | undefined,
): value is WorkspacePaneStaticViewType {
  return typeof value === 'string' && (WORKSPACE_PANE_STATIC_VIEW_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneBranchViewType(
  value: string | null | undefined,
): value is WorkspacePaneBranchViewType {
  return typeof value === 'string' && (WORKSPACE_PANE_BRANCH_VIEW_TYPES as readonly string[]).includes(value)
}

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
