import type {
  ClientWorkspaceState,
  FiletreeSessionViewState,
  NativeClientWorkspaceReadResult,
} from '#/shared/api-types.ts'
import { toSafeCanonicalRepoLocator } from '#/shared/repo-locator.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { isWorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { sessionLog } from '#/web/logger.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'
import { parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { canonicalWorkspaceLocator, workspaceLocatorsShareTransport } from '#/shared/workspace-locator.ts'
import { parseWorkspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

const CLIENT_WORKSPACE_STORAGE_KEY = 'goblin.workspace'

export async function readClientWorkspaceState(): Promise<ClientWorkspaceState> {
  if (readNativeBridge()) {
    // A native read failure must block boot persistence. Returning an empty
    // workspace here would allow a transient IPC error to overwrite good data.
    const result = await invokeNativeIpcPath<NativeClientWorkspaceReadResult>('clientWorkspace.read', undefined)
    if (result.kind === 'missing') return defaultClientWorkspaceState()
    if (result.kind === 'loaded') return normalizeClientWorkspaceState(result.state)
    throw new Error('Invalid native client workspace read result')
  }
  try {
    const raw = globalThis.localStorage?.getItem(CLIENT_WORKSPACE_STORAGE_KEY)
    return normalizeClientWorkspaceState(raw ? JSON.parse(raw) : null)
  } catch (err) {
    sessionLog.warn('failed to read local workspace state', { err })
    return defaultClientWorkspaceState()
  }
}

export async function writeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  const native = readNativeBridge()
  try {
    const normalized = normalizeClientWorkspaceState(state)
    if (native) {
      // Electron's embedded HTTP port may change between launches, so its
      // origin-scoped localStorage cannot own durable window state.
      await invokeNativeIpcPath('clientWorkspace.write', normalized)
      return
    }
    globalThis.localStorage?.setItem(CLIENT_WORKSPACE_STORAGE_KEY, JSON.stringify(normalized))
  } catch (err) {
    sessionLog.warn('failed to persist local workspace state', { err })
    if (native) throw err
  }
}

export function normalizeClientWorkspaceState(value: unknown): ClientWorkspaceState {
  const defaults = defaultClientWorkspaceState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const raw = value as Partial<ClientWorkspaceState> & {
    restoredRepoId?: unknown
    preferredWorkspacePaneTabByTargetByRepo?: unknown
    filetreeViewStateByWorktreeByRepo?: unknown
  }
  const layout = normalizeWorkspaceSessionLayoutState(raw)
  return {
    restoredWorkspaceId: toSafeCanonicalRepoLocator(
      migratedClientWorkspaceField(raw, 'restoredWorkspaceId', 'restoredRepoId'),
    ),
    ...layout,
    selectedTerminalSessionIdByTerminalWorktree: normalizeSelectedTerminals(
      raw.selectedTerminalSessionIdByTerminalWorktree,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: normalizePreferredTabs(
      migratedClientWorkspaceField(
        raw,
        'preferredWorkspacePaneTabByTargetByWorkspace',
        'preferredWorkspacePaneTabByTargetByRepo',
      ),
    ),
    filetreeViewStateByWorktreeByWorkspace: normalizeFiletreeState(
      migratedClientWorkspaceField(raw, 'filetreeViewStateByWorktreeByWorkspace', 'filetreeViewStateByWorktreeByRepo'),
    ),
  }
}

function migratedClientWorkspaceField(
  raw: Record<string, unknown>,
  currentField: string,
  legacyField: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(raw, currentField) ? raw[currentField] : raw[legacyField]
}

function normalizeSelectedTerminals(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, sessionId] of Object.entries(value)) {
    const parsed = parseTerminalWorktreeKey(key)
    if (!parsed) continue
    if (typeof sessionId !== 'string' || !sessionId) continue
    result[key] = sessionId
  }
  return result
}

function normalizePreferredTabs(value: unknown): ClientWorkspaceState['preferredWorkspacePaneTabByTargetByWorkspace'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByWorkspace'] = {}
  for (const [repoRoot, rawByTarget] of Object.entries(value)) {
    const safeRepoRoot = toSafeCanonicalRepoLocator(repoRoot)
    if (!safeRepoRoot || !rawByTarget || typeof rawByTarget !== 'object' || Array.isArray(rawByTarget)) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, preferredTab] of Object.entries(rawByTarget)) {
      const normalized = preferredTabFromUnknown(preferredTab)
      const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
      if (normalized !== undefined && target?.repoRoot === safeRepoRoot) byTarget[targetKey] = normalized
    }
    if (Object.keys(byTarget).length > 0) result[safeRepoRoot] = byTarget
  }
  return result
}

function preferredTabFromUnknown(value: unknown): WorkspacePaneSessionTabType | null | undefined {
  return value === null || (typeof value === 'string' && isWorkspacePaneSessionTabType(value)) ? value : undefined
}

function normalizeFiletreeState(value: unknown): ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ClientWorkspaceState['filetreeViewStateByWorktreeByWorkspace'] = {}
  for (const [repoRoot, rawByWorktree] of Object.entries(value)) {
    const safeRepoRoot = toSafeCanonicalRepoLocator(repoRoot)
    if (!safeRepoRoot || !rawByWorktree || typeof rawByWorktree !== 'object' || Array.isArray(rawByWorktree)) continue
    const byWorktree: Record<string, FiletreeSessionViewState> = {}
    for (const [worktreeId, rawSnapshot] of Object.entries(rawByWorktree)) {
      const snapshot = normalizeFiletreeSnapshot(rawSnapshot)
      if (
        canonicalWorkspaceLocator(worktreeId) === worktreeId &&
        workspaceLocatorsShareTransport(safeRepoRoot, worktreeId) &&
        snapshot
      ) {
        byWorktree[worktreeId] = snapshot
      }
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
