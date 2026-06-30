export const WORKSPACE_PANE_STATIC_TAB_TYPES = ['status', 'changes', 'history', 'files'] as const
export const WORKSPACE_PANE_TAB_TYPES = [...WORKSPACE_PANE_STATIC_TAB_TYPES, 'terminal'] as const
export const WORKSPACE_PANE_STATIC_TAB_IDS = {
  status: 'workspace-pane:status',
  changes: 'workspace-pane:changes',
  history: 'workspace-pane:history',
  files: 'workspace-pane:files',
} as const satisfies Record<(typeof WORKSPACE_PANE_STATIC_TAB_TYPES)[number], string>

export type WorkspacePaneStaticTabType = (typeof WORKSPACE_PANE_STATIC_TAB_TYPES)[number]
export type WorkspacePaneTabType = (typeof WORKSPACE_PANE_TAB_TYPES)[number]
export type WorkspacePaneStaticTabId = (typeof WORKSPACE_PANE_STATIC_TAB_IDS)[WorkspacePaneStaticTabType]
export type WorkspacePaneTabScope = 'branch' | 'worktree'
export const WORKSPACE_PANE_STATIC_TAB_SCOPES = {
  status: 'branch',
  changes: 'worktree',
  history: 'branch',
  files: 'worktree',
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
  tabId: WorkspacePaneStaticTabId
}

export interface WorkspacePaneTerminalTabOrderEntry {
  type: 'terminal'
  terminalSessionId: string
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

export function workspacePaneTabScope(tab: WorkspacePaneTabType): WorkspacePaneTabScope {
  return tab === 'terminal' ? 'worktree' : workspacePaneStaticTabScope(tab)
}

export function workspacePaneTabRequiresWorktree(tab: WorkspacePaneTabType): boolean {
  return workspacePaneTabScope(tab) === 'worktree'
}

export function isWorkspacePaneSessionTabType(value: string | null | undefined): value is WorkspacePaneSessionTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_SESSION_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneTabOrderEntry(value: unknown): value is WorkspacePaneTabOrderEntry {
  return workspacePaneTabOrderEntryFromUnknown(value) !== null
}

export function workspacePaneTabOrderEntryFromUnknown(value: unknown): WorkspacePaneTabOrderEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as { type?: unknown; tabId?: unknown; terminalSessionId?: unknown }
  const type = typeof entry.type === 'string' ? entry.type : null
  if (type === 'terminal') {
    return typeof entry.terminalSessionId === 'string' && entry.terminalSessionId.length > 0
      ? workspacePaneTerminalTabOrderEntry(entry.terminalSessionId)
      : null
  }
  if (!isWorkspacePaneStaticTabType(type)) return null
  const tabId = workspacePaneStaticTabId(type)
  if (entry.tabId === tabId) return workspacePaneStaticTabOrderEntry(type)
  return null
}

export function workspacePaneStaticTabOrderEntry(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabOrderEntry {
  return { type, tabId: workspacePaneStaticTabId(type) }
}

export function workspacePaneTerminalTabOrderEntry(terminalSessionId: string): WorkspacePaneTerminalTabOrderEntry {
  return { type: 'terminal', terminalSessionId }
}

export function workspacePaneTabOrderEntryIdentity(entry: WorkspacePaneTabOrderEntry): string {
  return entry.type === 'terminal' ? `terminal:${entry.terminalSessionId}` : entry.tabId
}

export function workspacePaneStaticTabId(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabId {
  return WORKSPACE_PANE_STATIC_TAB_IDS[type]
}
