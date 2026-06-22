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
export const WORKSPACE_PANE_SESSION_VIEW_TYPES = WORKSPACE_PANE_VIEW_TYPES
export type WorkspacePaneSessionView = (typeof WORKSPACE_PANE_SESSION_VIEW_TYPES)[number]

export interface WorkspacePaneStaticTabOrderEntry {
  type: WorkspacePaneStaticViewType
  id: WorkspacePaneStaticViewType
}

export interface WorkspacePaneTerminalTabOrderEntry {
  type: 'terminal'
  id: string
}

export type WorkspacePaneTabOrderEntry = WorkspacePaneStaticTabOrderEntry | WorkspacePaneTerminalTabOrderEntry

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

export function isWorkspacePaneTabOrderEntry(value: unknown): value is WorkspacePaneTabOrderEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<WorkspacePaneTabOrderEntry>
  if (entry.type === 'terminal') return typeof entry.id === 'string' && entry.id.length > 0
  return isWorkspacePaneStaticViewType(entry.type) && entry.id === entry.type
}

export function workspacePaneStaticTabOrderEntry(type: WorkspacePaneStaticViewType): WorkspacePaneStaticTabOrderEntry {
  return { type, id: type }
}

export function workspacePaneTerminalTabOrderEntry(id: string): WorkspacePaneTerminalTabOrderEntry {
  return { type: 'terminal', id }
}

export function workspacePaneTabOrderEntryIdentity(entry: WorkspacePaneTabOrderEntry): string {
  return `${entry.type}:${entry.id}`
}
