import type { ClientWorkspaceState, NativeClientWorkspaceReadResult } from '#/shared/api-types.ts'
import { CLIENT_WORKSPACE_STATE_VERSION } from '#/shared/api-types.ts'
import { decodeCurrentClientWorkspaceState } from '#/shared/client-workspace-state-schema.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { sessionLog } from '#/web/logger.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { invokeNativeIpcPath } from '#/web/native-host-client.ts'

const CLIENT_WORKSPACE_STORAGE_KEY = 'goblin.workspace'

export async function readClientWorkspaceState(): Promise<ClientWorkspaceState> {
  if (readNativeBridge()) {
    // A native read failure must block boot persistence. Returning an empty
    // workspace here would allow a transient IPC error to overwrite good data.
    const result = await invokeNativeIpcPath<NativeClientWorkspaceReadResult>('clientWorkspace.read', undefined)
    if (result.kind === 'missing') return defaultClientWorkspaceState()
    if (result.kind === 'loaded') {
      if (!isRecord(result.state)) throw new Error('Corrupt native client workspace state')
      return decodeCurrentClientWorkspaceState(result.state)
    }
    throw new Error('Invalid native client workspace read result')
  }
  try {
    const storage = browserClientWorkspaceStorage()
    const raw = storage.getItem(CLIENT_WORKSPACE_STORAGE_KEY)
    if (raw === null) return defaultClientWorkspaceState()
    const decoded: unknown = JSON.parse(raw)
    if (!isRecord(decoded)) throw new Error('Corrupt browser client workspace state')
    const parsed = decoded
    if ('version' in parsed && parsed.version !== CLIENT_WORKSPACE_STATE_VERSION) {
      throw new Error(`Unsupported browser client workspace state version: ${String(parsed.version)}`)
    }
    if (!hasExactKeys(parsed, ['version', 'state'])) throw new Error('Corrupt browser client workspace state envelope')
    if (!isRecord(parsed.state)) throw new Error('Corrupt browser client workspace state')
    return decodeCurrentClientWorkspaceState(parsed.state)
  } catch (err) {
    sessionLog.warn('failed to read local workspace state', { err })
    throw err
  }
}

export async function writeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  const native = readNativeBridge()
  try {
    const current = decodeCurrentClientWorkspaceState(state)
    if (native) {
      // Electron's embedded HTTP port may change between launches, so its
      // origin-scoped localStorage cannot own durable window state.
      await invokeNativeIpcPath('clientWorkspace.write', current)
      return
    }
    browserClientWorkspaceStorage().setItem(
      CLIENT_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: CLIENT_WORKSPACE_STATE_VERSION, state: current }),
    )
  } catch (err) {
    sessionLog.warn('failed to persist local workspace state', { err })
    throw err
  }
}

function browserClientWorkspaceStorage(): Storage {
  const storage = globalThis.localStorage
  if (!storage) throw new Error('Browser storage unavailable for client workspace state')
  return storage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}
