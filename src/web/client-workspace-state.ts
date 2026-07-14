import type { ClientWorkspaceState, FiletreeSessionViewState } from '#/shared/api-types.ts'
import { toSafeRepoLocator, toSafeSessionRepoEntry } from '#/shared/input-validation.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { isWorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { sessionLog } from '#/web/logger.ts'

const CLIENT_WORKSPACE_STORAGE_KEY = 'goblin.workspace'

export function readClientWorkspaceState(): ClientWorkspaceState {
  try {
    const raw = globalThis.localStorage?.getItem(CLIENT_WORKSPACE_STORAGE_KEY)
    return normalizeClientWorkspaceState(raw ? JSON.parse(raw) : null)
  } catch (err) {
    sessionLog.warn('failed to read local workspace state', { err })
    return defaultClientWorkspaceState()
  }
}

export function writeClientWorkspaceState(state: ClientWorkspaceState): void {
  try {
    globalThis.localStorage?.setItem(CLIENT_WORKSPACE_STORAGE_KEY, JSON.stringify(normalizeClientWorkspaceState(state)))
  } catch (err) {
    sessionLog.warn('failed to persist local workspace state', { err })
  }
}

export function normalizeClientWorkspaceState(value: unknown): ClientWorkspaceState {
  const defaults = defaultClientWorkspaceState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const raw = value as Partial<ClientWorkspaceState>
  const layout = normalizeWorkspaceSessionLayoutState(raw)
  return {
    openRepoEntries: normalizeOpenRepoEntries(raw.openRepoEntries),
    restoredRepoId: toSafeRepoLocator(raw.restoredRepoId) ?? null,
    ...layout,
    selectedTerminalSessionIdByTerminalWorktree: normalizeSelectedTerminals(
      raw.selectedTerminalSessionIdByTerminalWorktree,
    ),
    preferredWorkspacePaneTabByTargetByRepo: normalizePreferredTabs(raw.preferredWorkspacePaneTabByTargetByRepo),
    filetreeViewStateByWorktreeByRepo: normalizeFiletreeState(raw.filetreeViewStateByWorktreeByRepo),
  }
}

function normalizeOpenRepoEntries(value: unknown): RepoSessionEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const entries: RepoSessionEntry[] = []
  for (const candidate of value) {
    const entry = toSafeSessionRepoEntry(candidate)
    if (!entry) continue
    const id = repoSessionEntryId(entry)
    if (seen.has(id)) continue
    seen.add(id)
    entries.push(entry)
  }
  return entries
}

function normalizeSelectedTerminals(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, sessionId] of Object.entries(value)) {
    const [repoRoot, worktreePath, extra] = key.split('\0')
    if (extra !== undefined || !toSafeRepoLocator(repoRoot) || !worktreePath) continue
    if (typeof sessionId !== 'string' || !sessionId) continue
    result[key] = sessionId
  }
  return result
}

function normalizePreferredTabs(value: unknown): ClientWorkspaceState['preferredWorkspacePaneTabByTargetByRepo'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByRepo'] = {}
  for (const [repoRoot, rawByTarget] of Object.entries(value)) {
    const safeRepoRoot = toSafeRepoLocator(repoRoot)
    if (!safeRepoRoot || !rawByTarget || typeof rawByTarget !== 'object' || Array.isArray(rawByTarget)) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, preferredTab] of Object.entries(rawByTarget)) {
      const normalized = preferredTabFromUnknown(preferredTab)
      if (normalized !== undefined) byTarget[targetKey] = normalized
    }
    if (Object.keys(byTarget).length > 0) result[safeRepoRoot] = byTarget
  }
  return result
}

function preferredTabFromUnknown(value: unknown): WorkspacePaneSessionTabType | null | undefined {
  return value === null || (typeof value === 'string' && isWorkspacePaneSessionTabType(value)) ? value : undefined
}

function normalizeFiletreeState(value: unknown): ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ClientWorkspaceState['filetreeViewStateByWorktreeByRepo'] = {}
  for (const [repoRoot, rawByWorktree] of Object.entries(value)) {
    const safeRepoRoot = toSafeRepoLocator(repoRoot)
    if (!safeRepoRoot || !rawByWorktree || typeof rawByWorktree !== 'object' || Array.isArray(rawByWorktree)) continue
    const byWorktree: Record<string, FiletreeSessionViewState> = {}
    for (const [worktreePath, rawSnapshot] of Object.entries(rawByWorktree)) {
      const snapshot = normalizeFiletreeSnapshot(rawSnapshot)
      if (worktreePath && snapshot) byWorktree[worktreePath] = snapshot
    }
    if (Object.keys(byWorktree).length > 0) result[safeRepoRoot] = byWorktree
  }
  return result
}

function normalizeFiletreeSnapshot(value: unknown): FiletreeSessionViewState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<FiletreeSessionViewState>
  return {
    selectedKeys: normalizeKeys(raw.selectedKeys),
    expandedKeys: normalizeKeys(raw.expandedKeys),
    topVisibleRowIndex:
      typeof raw.topVisibleRowIndex === 'number' && Number.isFinite(raw.topVisibleRowIndex)
        ? Math.max(0, Math.floor(raw.topVisibleRowIndex))
        : 0,
  }
}

function normalizeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((key): key is string => typeof key === 'string' && !!key && !key.includes('\0'))),
  )
}
