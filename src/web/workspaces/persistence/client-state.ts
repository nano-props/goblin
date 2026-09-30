import type { ClientWorkspaceState } from '#/shared/api-types.ts'
import {
  decodeCurrentClientWorkspaceState,
  isClientWorkspaceStateDecodeError,
  parseClientWorkspaceStateJson,
  stringifyClientWorkspaceState,
} from '#/shared/client-workspace-state-schema.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { sessionLog } from '#/web/logger.ts'

const CLIENT_WORKSPACE_STORAGE_KEY = 'goblin.workspace'

// Client-local restorable presentation is stored in localStorage.
// Server workspace and repository authority never lives here.

export async function readClientWorkspaceState(): Promise<ClientWorkspaceState> {
  try {
    const storage = browserClientWorkspaceStorage()
    const raw = storage.getItem(CLIENT_WORKSPACE_STORAGE_KEY)
    if (raw === null) {
      const state = defaultClientWorkspaceState()
      storage.setItem(CLIENT_WORKSPACE_STORAGE_KEY, stringifyClientWorkspaceState(state))
      return state
    }
    try {
      return parseClientWorkspaceStateJson(raw)
    } catch (err) {
      if (!isClientWorkspaceStateDecodeError(err)) throw err
      const state = defaultClientWorkspaceState()
      sessionLog.warn('replacing invalid local workspace state with defaults', { err })
      storage.setItem(CLIENT_WORKSPACE_STORAGE_KEY, stringifyClientWorkspaceState(state))
      return state
    }
  } catch (err) {
    sessionLog.warn('failed to read local workspace state', { err })
    throw err
  }
}

export async function writeClientWorkspaceState(state: ClientWorkspaceState): Promise<void> {
  try {
    const current = decodeCurrentClientWorkspaceState(state)
    browserClientWorkspaceStorage().setItem(CLIENT_WORKSPACE_STORAGE_KEY, stringifyClientWorkspaceState(current))
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
