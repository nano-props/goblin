export const WORKSPACE_PANE_STATIC_VIEW_TYPES = ['status', 'changes', 'history'] as const
export const WORKSPACE_PANE_VIEW_TYPES = [...WORKSPACE_PANE_STATIC_VIEW_TYPES, 'terminal'] as const

export type WorkspacePaneStaticViewType = (typeof WORKSPACE_PANE_STATIC_VIEW_TYPES)[number]
export type WorkspacePaneViewType = (typeof WORKSPACE_PANE_VIEW_TYPES)[number]
export type WorkspacePaneView = WorkspacePaneViewType
export const WORKSPACE_PANE_BRANCH_VIEW_TYPES = ['status', 'history'] as const satisfies readonly WorkspacePaneStaticViewType[]
export type WorkspacePaneBranchViewType = (typeof WORKSPACE_PANE_BRANCH_VIEW_TYPES)[number]
export const WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES = ['changes'] as const satisfies readonly WorkspacePaneStaticViewType[]
export type WorkspacePaneWorktreeStaticViewType = (typeof WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES)[number]
export const WORKSPACE_PANE_WORKTREE_VIEW_TYPES = [
  ...WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES,
  'terminal',
] as const satisfies readonly WorkspacePaneViewType[]
export type WorkspacePaneWorktreeViewType = (typeof WORKSPACE_PANE_WORKTREE_VIEW_TYPES)[number]
export const WORKSPACE_PANE_SESSION_VIEW_TYPES = [
  ...WORKSPACE_PANE_BRANCH_VIEW_TYPES,
  'terminal',
] as const satisfies readonly WorkspacePaneViewType[]
export type WorkspacePaneSessionView = (typeof WORKSPACE_PANE_SESSION_VIEW_TYPES)[number]

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

export function isWorkspacePaneWorktreeStaticViewType(
  value: string | null | undefined,
): value is WorkspacePaneWorktreeStaticViewType {
  return typeof value === 'string' && (WORKSPACE_PANE_WORKTREE_STATIC_VIEW_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneSessionViewType(
  value: string | null | undefined,
): value is WorkspacePaneSessionView {
  return typeof value === 'string' && (WORKSPACE_PANE_SESSION_VIEW_TYPES as readonly string[]).includes(value)
}

export interface WorkspacePaneWorktreeViewOrderEntry {
  type: WorkspacePaneWorktreeViewType
  id: string
}

export interface WorkspacePaneStaticViewSummary {
  type: WorkspacePaneWorktreeStaticViewType
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
  type: WorkspacePaneWorktreeStaticViewType
}

export interface WorkspacePaneReorderInput {
  repoRoot: string
  worktreePath: string
  orderedViews: WorkspacePaneWorktreeViewOrderEntry[]
}
