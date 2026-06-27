export const WORKSPACE_PANE_STATIC_TAB_TYPES = ['status', 'changes', 'history'] as const
export const WORKSPACE_PANE_TAB_TYPES = [...WORKSPACE_PANE_STATIC_TAB_TYPES, 'terminal'] as const

export type WorkspacePaneStaticTabType = (typeof WORKSPACE_PANE_STATIC_TAB_TYPES)[number]
export type WorkspacePaneTabType = (typeof WORKSPACE_PANE_TAB_TYPES)[number]
export type WorkspacePaneTabScope = 'branch' | 'worktree'
export const WORKSPACE_PANE_STATIC_TAB_SCOPES = {
  status: 'branch',
  changes: 'worktree',
  history: 'branch',
} as const satisfies Record<WorkspacePaneStaticTabType, WorkspacePaneTabScope>
type WorkspacePaneStaticTabTypeWithScope<TScope extends WorkspacePaneTabScope> = {
  [TType in WorkspacePaneStaticTabType]: (typeof WORKSPACE_PANE_STATIC_TAB_SCOPES)[TType] extends TScope ? TType : never
}[WorkspacePaneStaticTabType]
export type WorkspacePaneBranchTabType = WorkspacePaneStaticTabTypeWithScope<'branch'>
export type WorkspacePaneWorktreeStaticTabType = WorkspacePaneStaticTabTypeWithScope<'worktree'>
export type WorkspacePaneWorktreeTabType = WorkspacePaneWorktreeStaticTabType | 'terminal'
export const WORKSPACE_PANE_BRANCH_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneBranchTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'branch',
)
export const WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneWorktreeStaticTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'worktree',
)
export const WORKSPACE_PANE_WORKTREE_TAB_TYPES = [
  ...WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  'terminal',
] as readonly WorkspacePaneWorktreeTabType[]
export const WORKSPACE_PANE_SESSION_TAB_TYPES = WORKSPACE_PANE_TAB_TYPES
export type WorkspacePaneSessionTabType = (typeof WORKSPACE_PANE_SESSION_TAB_TYPES)[number]

export interface WorkspacePaneStaticTabOrderEntry {
  type: WorkspacePaneStaticTabType
  id: WorkspacePaneStaticTabType
}

export interface WorkspacePaneTerminalTabOrderEntry {
  type: 'terminal'
  id: string
}

export type WorkspacePaneTabOrderEntry = WorkspacePaneStaticTabOrderEntry | WorkspacePaneTerminalTabOrderEntry

export function isWorkspacePaneTabType(value: string | null | undefined): value is WorkspacePaneTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneStaticTabType(value: string | null | undefined): value is WorkspacePaneStaticTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_STATIC_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneBranchTabType(value: string | null | undefined): value is WorkspacePaneBranchTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_BRANCH_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneWorktreeStaticTabType(
  value: string | null | undefined,
): value is WorkspacePaneWorktreeStaticTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES as readonly string[]).includes(value)
}

export function workspacePaneStaticTabScope(tab: WorkspacePaneStaticTabType): WorkspacePaneTabScope {
  return WORKSPACE_PANE_STATIC_TAB_SCOPES[tab]
}

export function workspacePaneTabScope(view: WorkspacePaneTabType): WorkspacePaneTabScope {
  return view === 'terminal' ? 'worktree' : workspacePaneStaticTabScope(view)
}

export function workspacePaneTabRequiresWorktree(view: WorkspacePaneTabType): boolean {
  return workspacePaneTabScope(view) === 'worktree'
}

export function isWorkspacePaneSessionTabType(value: string | null | undefined): value is WorkspacePaneSessionTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_SESSION_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneTabOrderEntry(value: unknown): value is WorkspacePaneTabOrderEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<WorkspacePaneTabOrderEntry>
  if (entry.type === 'terminal') return typeof entry.id === 'string' && entry.id.length > 0
  return isWorkspacePaneStaticTabType(entry.type) && entry.id === entry.type
}

export function workspacePaneStaticTabOrderEntry(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabOrderEntry {
  return { type, id: type }
}

export function workspacePaneTerminalTabOrderEntry(id: string): WorkspacePaneTerminalTabOrderEntry {
  return { type: 'terminal', id }
}

export function workspacePaneTabOrderEntryIdentity(entry: WorkspacePaneTabOrderEntry): string {
  return `${entry.type}:${entry.id}`
}
