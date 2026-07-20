import type {
  ClientWorkspaceState,
  FiletreeSessionViewState,
  NativeClientWorkspaceReadResult,
} from '#/shared/api-types.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { isWorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneSessionTabType } from '#/shared/workspace-pane.ts'
import { normalizeWorkspaceSessionLayoutState } from '#/shared/workspace-layout.ts'
import { sessionLog } from '#/web/logger.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'
import { parseTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import {
  canonicalWorkspaceLocator,
  toSafeCanonicalWorkspaceId,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'
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
  if (!isRecord(value)) return defaults
  const raw = value
  const layout = normalizeWorkspaceSessionLayoutState(raw)
  return {
    restoredWorkspaceId: toSafeCanonicalWorkspaceId(raw.restoredWorkspaceId),
    ...layout,
    selectedTerminalSessionIdByTerminalFilesystemTarget: normalizeSelectedTerminals(
      raw.selectedTerminalSessionIdByTerminalFilesystemTarget,
    ),
    preferredWorkspacePaneTabByTargetByWorkspace: normalizePreferredTabs(
      raw.preferredWorkspacePaneTabByTargetByWorkspace,
    ),
    filetreeViewStateByFilesystemTargetByWorkspace: normalizeFiletreeState(
      raw.filetreeViewStateByFilesystemTargetByWorkspace,
    ),
  }
}

function normalizeSelectedTerminals(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, sessionId] of Object.entries(value)) {
    const parsed = parseTerminalFilesystemTargetKey(key)
    if (!parsed) continue
    if (typeof sessionId !== 'string' || !sessionId) continue
    result[key] = sessionId
  }
  return result
}

function normalizePreferredTabs(value: unknown): ClientWorkspaceState['preferredWorkspacePaneTabByTargetByWorkspace'] {
  if (!isRecord(value)) return {}
  const result: ClientWorkspaceState['preferredWorkspacePaneTabByTargetByWorkspace'] = {}
  for (const [workspaceId, rawByTarget] of Object.entries(value)) {
    const safeWorkspaceId = toSafeCanonicalWorkspaceId(workspaceId)
    if (!safeWorkspaceId || !isRecord(rawByTarget)) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType | null> = {}
    for (const [targetKey, preferredTab] of Object.entries(rawByTarget)) {
      const normalized = preferredTabFromUnknown(preferredTab)
      const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
      if (normalized !== undefined && target?.workspaceId === safeWorkspaceId) byTarget[targetKey] = normalized
    }
    if (Object.keys(byTarget).length > 0) result[safeWorkspaceId] = byTarget
  }
  return result
}

function preferredTabFromUnknown(value: unknown): WorkspacePaneSessionTabType | null | undefined {
  return value === null || (typeof value === 'string' && isWorkspacePaneSessionTabType(value)) ? value : undefined
}

function normalizeFiletreeState(
  value: unknown,
): ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'] {
  if (!isRecord(value)) return {}
  const result: ClientWorkspaceState['filetreeViewStateByFilesystemTargetByWorkspace'] = {}
  for (const [workspaceId, rawByFilesystemTarget] of Object.entries(value)) {
    const safeWorkspaceId = toSafeCanonicalWorkspaceId(workspaceId)
    if (!safeWorkspaceId || !isRecord(rawByFilesystemTarget)) continue
    const byFilesystemTarget: Record<string, FiletreeSessionViewState> = {}
    for (const [filesystemTargetId, rawSnapshot] of Object.entries(rawByFilesystemTarget)) {
      const snapshot = normalizeFiletreeSnapshot(rawSnapshot)
      if (
        canonicalWorkspaceLocator(filesystemTargetId) === filesystemTargetId &&
        workspaceLocatorsShareTransport(safeWorkspaceId, filesystemTargetId) &&
        snapshot
      ) {
        byFilesystemTarget[filesystemTargetId] = snapshot
      }
    }
    if (Object.keys(byFilesystemTarget).length > 0) result[safeWorkspaceId] = byFilesystemTarget
  }
  return result
}

function normalizeFiletreeSnapshot(value: unknown): FiletreeSessionViewState | null {
  if (!isRecord(value)) return null
  const raw = value
  return {
    selectedKeys: normalizeKeys(raw.selectedKeys),
    expandedKeys: normalizeKeys(raw.expandedKeys),
    topVisibleRowIndex:
      typeof raw.topVisibleRowIndex === 'number' && Number.isFinite(raw.topVisibleRowIndex)
        ? Math.max(0, Math.floor(raw.topVisibleRowIndex))
        : 0,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((key): key is string => typeof key === 'string' && !!key && !key.includes('\0'))),
  )
}
