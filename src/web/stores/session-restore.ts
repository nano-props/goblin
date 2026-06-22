// Renderer-side restorable-state bridge for boot-only session restore.
// Persisted settings and external-app detection now flow through
// TanStack Query; this store exists only so bootstrap can consume the
// one-shot saved session snapshot.

import { create, type StoreApi } from 'zustand'
import type { SessionState, SettingsSnapshot } from '#/shared/api-types.ts'
import { restorableSessionStateFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import { getSettingsSnapshot } from '#/web/settings-client.ts'
import { DEFAULT_WORKSPACE_FOCUSED, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'

export const DEFAULT_RESTORABLE_SESSION_STATE: SessionState = {
  openRepos: [],
  activeRepo: null,
  workspaceFocused: DEFAULT_WORKSPACE_FOCUSED,
  workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  selectedTerminalByWorktree: {},
  workspacePaneTabOrderByBranchByRepo: {},
}

interface SessionRestoreStore {
  /** Session snapshot from the previous run — consumed once during
   *  bootstrap, then cleared so it does not masquerade as live state or
   *  imply runtime two-way sync with the repos store. */
  bootSessionSnapshot: SessionState | null

  /** Fetches the latest persisted settings snapshot plus the boot-only
   *  session snapshot; this is not runtime-coherent state. */
  hydrate: () => Promise<SessionState>
  /** Applies an already-fetched settings snapshot to avoid duplicate boot fetches. */
  hydrateFromSettingsSnapshot: (snapshot: Pick<SettingsSnapshot, 'session'>) => SessionState
  /** Returns the boot session snapshot once, then clears it so all later
   *  session writes remain renderer -> persistence only. */
  consumeBootSessionSnapshot: () => SessionState
}

type SessionRestoreSet = StoreApi<SessionRestoreStore>['setState']

let hydrateVersion = 0

function commitBootSessionSnapshot(
  set: SessionRestoreSet,
  version: number,
  snapshot: Pick<SettingsSnapshot, 'session'>,
): SessionState {
  const session = restorableSessionStateFromSettingsSnapshot(snapshot)
  if (version === hydrateVersion) set({ bootSessionSnapshot: session })
  return session
}

export const useSessionRestoreStore = create<SessionRestoreStore>((set, get) => ({
  bootSessionSnapshot: null,

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await getSettingsSnapshot()
    return commitBootSessionSnapshot(set, version, snap)
  },

  hydrateFromSettingsSnapshot(snapshot) {
    const version = ++hydrateVersion
    return commitBootSessionSnapshot(set, version, snapshot)
  },

  consumeBootSessionSnapshot(): SessionState {
    const snapshot: SessionState = get().bootSessionSnapshot ?? DEFAULT_RESTORABLE_SESSION_STATE
    set((s) => (s.bootSessionSnapshot === null ? s : { bootSessionSnapshot: null }))
    return snapshot
  },
}))
