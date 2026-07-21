import { isStringIn } from '#/shared/string-literals.ts'

export const WORKSPACE_PANE_STATIC_TAB_TYPES = ['status', 'changes', 'history', 'files'] as const
export type WorkspacePaneDefaultTargetKind = 'git' | 'workspace-root'
export const WORKSPACE_PANE_RUNTIME_TAB_TYPES = ['terminal'] as const
export const WORKSPACE_PANE_TAB_TYPES = [
  ...WORKSPACE_PANE_STATIC_TAB_TYPES,
  ...WORKSPACE_PANE_RUNTIME_TAB_TYPES,
] as const
export const WORKSPACE_PANE_STATIC_TAB_IDS = {
  status: 'workspace-pane:status',
  changes: 'workspace-pane:changes',
  history: 'workspace-pane:history',
  files: 'workspace-pane:files',
} as const satisfies Record<(typeof WORKSPACE_PANE_STATIC_TAB_TYPES)[number], string>

export type WorkspacePaneStaticTabType = (typeof WORKSPACE_PANE_STATIC_TAB_TYPES)[number]
export type WorkspacePaneRuntimeTabType = (typeof WORKSPACE_PANE_RUNTIME_TAB_TYPES)[number]
export type WorkspacePaneTabType = (typeof WORKSPACE_PANE_TAB_TYPES)[number]
export type WorkspacePaneStaticTabId = (typeof WORKSPACE_PANE_STATIC_TAB_IDS)[WorkspacePaneStaticTabType]
export type WorkspacePaneTabScope = 'branch' | 'worktree'
export const WORKSPACE_PANE_STATIC_TAB_SCOPES = {
  status: 'branch',
  changes: 'worktree',
  history: 'branch',
  files: 'worktree',
} as const satisfies Record<WorkspacePaneStaticTabType, WorkspacePaneTabScope>
export const WORKSPACE_PANE_RUNTIME_TAB_SCOPES = {
  terminal: 'worktree',
} as const satisfies Record<WorkspacePaneRuntimeTabType, WorkspacePaneTabScope>
type WorkspacePaneStaticTabTypeWithScope<TScope extends WorkspacePaneTabScope> = {
  [TType in WorkspacePaneStaticTabType]: (typeof WORKSPACE_PANE_STATIC_TAB_SCOPES)[TType] extends TScope ? TType : never
}[WorkspacePaneStaticTabType]
export type WorkspacePaneBranchTabType = WorkspacePaneStaticTabTypeWithScope<'branch'>
export type WorkspacePaneWorktreeStaticTabType = WorkspacePaneStaticTabTypeWithScope<'worktree'>
export type WorkspacePaneWorktreeTabType = WorkspacePaneWorktreeStaticTabType | WorkspacePaneRuntimeTabType
export const WORKSPACE_PANE_BRANCH_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneBranchTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'branch',
)
export const WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES = WORKSPACE_PANE_STATIC_TAB_TYPES.filter(
  (type): type is WorkspacePaneWorktreeStaticTabType => WORKSPACE_PANE_STATIC_TAB_SCOPES[type] === 'worktree',
)
export const WORKSPACE_PANE_WORKTREE_TAB_TYPES = [
  ...WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES,
  ...WORKSPACE_PANE_RUNTIME_TAB_TYPES,
] satisfies readonly WorkspacePaneWorktreeTabType[]
// Session-persistence allow-list for selected workspace-pane tab types.
// Server-owned runtime tab entries are modeled by WORKSPACE_PANE_RUNTIME_TAB_TYPES.
export const WORKSPACE_PANE_SESSION_TAB_TYPES = WORKSPACE_PANE_TAB_TYPES
export type WorkspacePaneSessionTabType = (typeof WORKSPACE_PANE_SESSION_TAB_TYPES)[number]

export interface WorkspacePaneStaticTabEntry {
  type: WorkspacePaneStaticTabType
  tabId: WorkspacePaneStaticTabId
}

export interface WorkspacePaneRuntimeTabEntry {
  type: WorkspacePaneRuntimeTabType
  runtimeSessionId: string
}

export type WorkspacePaneTabEntry = WorkspacePaneStaticTabEntry | WorkspacePaneRuntimeTabEntry

export function isWorkspacePaneTabType(value: string | null | undefined): value is WorkspacePaneTabType {
  return isStringIn(WORKSPACE_PANE_TAB_TYPES, value)
}

export function isWorkspacePaneStaticTabType(value: string | null | undefined): value is WorkspacePaneStaticTabType {
  return isStringIn(WORKSPACE_PANE_STATIC_TAB_TYPES, value)
}

export function isWorkspacePaneRuntimeTabType(value: string | null | undefined): value is WorkspacePaneRuntimeTabType {
  return isStringIn(WORKSPACE_PANE_RUNTIME_TAB_TYPES, value)
}

export function isWorkspacePaneBranchTabType(value: string | null | undefined): value is WorkspacePaneBranchTabType {
  return isStringIn(WORKSPACE_PANE_BRANCH_TAB_TYPES, value)
}

export function isWorkspacePaneWorktreeStaticTabType(
  value: string | null | undefined,
): value is WorkspacePaneWorktreeStaticTabType {
  return isStringIn(WORKSPACE_PANE_WORKTREE_STATIC_TAB_TYPES, value)
}

export function workspacePaneStaticTabScope(tab: WorkspacePaneStaticTabType): WorkspacePaneTabScope {
  return WORKSPACE_PANE_STATIC_TAB_SCOPES[tab]
}

export function workspacePaneRuntimeTabScope(tab: WorkspacePaneRuntimeTabType): WorkspacePaneTabScope {
  return WORKSPACE_PANE_RUNTIME_TAB_SCOPES[tab]
}

export function workspacePaneTabScope(tab: WorkspacePaneTabType): WorkspacePaneTabScope {
  return isWorkspacePaneRuntimeTabType(tab) ? workspacePaneRuntimeTabScope(tab) : workspacePaneStaticTabScope(tab)
}

export function workspacePaneTabRequiresWorktree(tab: WorkspacePaneTabType): boolean {
  return workspacePaneTabScope(tab) === 'worktree'
}

export function isWorkspacePaneSessionTabType(value: string | null | undefined): value is WorkspacePaneSessionTabType {
  return isStringIn(WORKSPACE_PANE_SESSION_TAB_TYPES, value)
}

export function isWorkspacePaneTabEntry(value: unknown): value is WorkspacePaneTabEntry {
  return workspacePaneTabEntryFromUnknown(value) !== null
}

export function workspacePaneTabEntryFromUnknown(value: unknown): WorkspacePaneTabEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as { type?: unknown; tabId?: unknown; runtimeSessionId?: unknown }
  const type = typeof entry.type === 'string' ? entry.type : null
  if (isWorkspacePaneRuntimeTabType(type)) {
    return typeof entry.runtimeSessionId === 'string' && entry.runtimeSessionId.length > 0
      ? workspacePaneRuntimeTabEntry(type, entry.runtimeSessionId)
      : null
  }
  if (isWorkspacePaneStaticTabType(type)) {
    const tabId = workspacePaneStaticTabId(type)
    return entry.tabId === tabId ? workspacePaneStaticTabEntry(type) : null
  }
  return null
}

export function workspacePaneStaticTabEntry(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabEntry {
  return { type, tabId: workspacePaneStaticTabId(type) }
}

export function defaultWorkspacePaneTabEntries(kind: WorkspacePaneDefaultTargetKind): WorkspacePaneTabEntry[] {
  return kind === 'workspace-root'
    ? [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')]
    : [workspacePaneStaticTabEntry('status')]
}

export function workspacePaneRuntimeTabEntry(
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
): WorkspacePaneRuntimeTabEntry {
  return { type, runtimeSessionId: sessionId }
}

export function workspacePaneRuntimeTabSessionId(entry: WorkspacePaneRuntimeTabEntry): string {
  return entry.runtimeSessionId
}

export function workspacePaneRuntimeTabIdentity(type: WorkspacePaneRuntimeTabType, sessionId: string): string {
  return `${type}:${sessionId}`
}

export function isWorkspacePaneRuntimeTabEntry(entry: WorkspacePaneTabEntry): entry is WorkspacePaneRuntimeTabEntry {
  return isWorkspacePaneRuntimeTabType(entry.type)
}

export function workspacePaneTabEntryIdentity(entry: WorkspacePaneTabEntry): string {
  return isWorkspacePaneRuntimeTabEntry(entry)
    ? workspacePaneRuntimeTabIdentity(entry.type, workspacePaneRuntimeTabSessionId(entry))
    : entry.tabId
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

export function workspacePaneTabsMoveEntryAfterIdentity<TEntry extends WorkspacePaneTabEntry>(
  current: readonly TEntry[],
  entryIndex: number,
  insertAfterIdentity?: string | null,
): TEntry[] {
  if (!insertAfterIdentity) return [...current]
  const entry = current[entryIndex]
  if (!entry) return [...current]
  if (workspacePaneTabEntryIdentity(entry) === insertAfterIdentity) return [...current]
  const withoutEntry = [...current.slice(0, entryIndex), ...current.slice(entryIndex + 1)]
  if (!withoutEntry.some((candidate) => workspacePaneTabEntryIdentity(candidate) === insertAfterIdentity)) {
    return [...current]
  }
  return workspacePaneTabsInsertAfterIdentity(withoutEntry, entry, insertAfterIdentity)
}

export function workspacePaneTabsWithRuntimeTab(
  current: readonly WorkspacePaneTabEntry[],
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  options?: { insertAfterIdentity?: string | null },
): WorkspacePaneTabEntry[] {
  if (sessionId.length === 0) return [...current]
  const existingIndex = current.findIndex(
    (entry) =>
      isWorkspacePaneRuntimeTabEntry(entry) &&
      entry.type === type &&
      workspacePaneRuntimeTabSessionId(entry) === sessionId,
  )
  if (existingIndex !== -1) {
    return workspacePaneTabsMoveEntryAfterIdentity(current, existingIndex, options?.insertAfterIdentity)
  }
  return workspacePaneTabsInsertAfterIdentity(
    current,
    workspacePaneRuntimeTabEntry(type, sessionId),
    options?.insertAfterIdentity,
  )
}

export function workspacePaneStaticTabId(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTabId {
  return WORKSPACE_PANE_STATIC_TAB_IDS[type]
}
