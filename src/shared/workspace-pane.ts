export const WORKSPACE_PANE_STATIC_TAB_TYPES = ['status', 'changes', 'history', 'files'] as const
export const WORKSPACE_PANE_TAB_TYPES = [...WORKSPACE_PANE_STATIC_TAB_TYPES, 'terminal', 'agent'] as const
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
export type WorkspacePaneWorktreeTabType = WorkspacePaneWorktreeStaticTabType | 'terminal' | 'agent'
export const WORKSPACE_PANE_BRANCH_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneBranchTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'branch',
)
export const WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneWorktreeStaticTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'worktree',
)
export const WORKSPACE_PANE_WORKTREE_TAB_TYPES = [
  ...WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  'terminal',
  'agent',
] as readonly WorkspacePaneWorktreeTabType[]
export const WORKSPACE_PANE_SESSION_TAB_TYPES = WORKSPACE_PANE_TAB_TYPES
export type WorkspacePaneSessionTabType = (typeof WORKSPACE_PANE_SESSION_TAB_TYPES)[number]

export interface WorkspacePaneStaticTabEntry {
  type: WorkspacePaneStaticTabType
  tabId: WorkspacePaneStaticTabId
}

export interface WorkspacePaneTerminalTabEntry {
  type: 'terminal'
  terminalSessionId: string
}

export interface WorkspacePaneAgentTabEntry {
  type: 'agent'
  agentSessionId: string
}

export type WorkspacePaneTabEntry = WorkspacePaneStaticTabEntry | WorkspacePaneTerminalTabEntry | WorkspacePaneAgentTabEntry

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
  return tab === 'terminal' || tab === 'agent' ? 'worktree' : workspacePaneStaticTabScope(tab)
}

export function workspacePaneTabRequiresWorktree(tab: WorkspacePaneTabType): boolean {
  return workspacePaneTabScope(tab) === 'worktree'
}

export function isWorkspacePaneSessionTabType(value: string | null | undefined): value is WorkspacePaneSessionTabType {
  return typeof value === 'string' && (WORKSPACE_PANE_SESSION_TAB_TYPES as readonly string[]).includes(value)
}

export function isWorkspacePaneTabEntry(value: unknown): value is WorkspacePaneTabEntry {
  return workspacePaneTabEntryFromUnknown(value) !== null
}

export function workspacePaneTabEntryFromUnknown(value: unknown): WorkspacePaneTabEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as { type?: unknown; tabId?: unknown; terminalSessionId?: unknown; agentSessionId?: unknown }
  const type = typeof entry.type === 'string' ? entry.type : null
  if (type === 'terminal') {
    return typeof entry.terminalSessionId === 'string' && entry.terminalSessionId.length > 0
      ? workspacePaneTerminalTabEntry(entry.terminalSessionId)
      : null
  }
  if (type === 'agent') {
    return typeof entry.agentSessionId === 'string' && entry.agentSessionId.length > 0
      ? workspacePaneAgentTabEntry(entry.agentSessionId)
      : null
  }
  if (!isWorkspacePaneStaticTabType(type)) return null
  const tabId = workspacePaneStaticTabId(type)
  if (entry.tabId === tabId) return workspacePaneStaticTabEntry(type)
  return null
}

export function workspacePaneStaticTabEntry(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabEntry {
  return { type, tabId: workspacePaneStaticTabId(type) }
}

export function workspacePaneTerminalTabEntry(terminalSessionId: string): WorkspacePaneTerminalTabEntry {
  return { type: 'terminal', terminalSessionId }
}

export function workspacePaneAgentTabEntry(agentSessionId: string): WorkspacePaneAgentTabEntry {
  return { type: 'agent', agentSessionId }
}

export function workspacePaneTabEntryIdentity(entry: WorkspacePaneTabEntry): string {
  if (entry.type === 'terminal') return `terminal:${entry.terminalSessionId}`
  if (entry.type === 'agent') return `agent:${entry.agentSessionId}`
  return entry.tabId
}

export function workspacePaneTabsInsertAfterIdentity<TEntry extends WorkspacePaneTabEntry>(
  current: readonly TEntry[],
  entry: TEntry,
  insertAfterIdentity?: string | null,
): TEntry[] {
  if (!insertAfterIdentity) return [...current, entry]
  const insertAfterIndex = current.findIndex(
    (candidate) => workspacePaneTabEntryIdentity(candidate) === insertAfterIdentity,
  )
  if (insertAfterIndex === -1) return [...current, entry]
  return [...current.slice(0, insertAfterIndex + 1), entry, ...current.slice(insertAfterIndex + 1)]
}

export function workspacePaneStaticTabId(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabId {
  return WORKSPACE_PANE_STATIC_TAB_IDS[type]
}
