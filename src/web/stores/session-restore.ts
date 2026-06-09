// Renderer-side restorable-state bridge for boot-only session restore.
// Persisted settings and external-app detection now flow through
// TanStack Query; this store exists only so bootstrap can consume the
// one-shot saved session snapshot.

import { create } from 'zustand'
import type { SessionState } from '#/shared/rpc.ts'
import { restorableSessionStateFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import { getSettingsSnapshot } from '#/web/settings-client.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'

export const DEFAULT_RESTORABLE_SESSION_STATE: SessionState = {
  openRepos: [],
  activeRepo: null,
  detailCollapsed: true,
  detailFocusMode: false,
  workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
  detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  selectedTerminalByWorktree: {},
}

interface SessionRestoreStore {
  /** Session snapshot from the previous run — consumed once during
   *  bootstrap, then cleared so it does not masquerade as live state or
   *  imply runtime two-way sync with the repos store. */
  bootSessionSnapshot: SessionState | null

  /** Fetches the latest persisted settings snapshot plus the boot-only
   *  session snapshot; this is not runtime-coherent state. */
  hydrate: () => Promise<SessionState>
  /** Returns the boot session snapshot once, then clears it so all later
   *  session writes remain renderer -> persistence only. */
  consumeBootSessionSnapshot: () => SessionState
}

let hydrateVersion = 0

export const useSessionRestoreStore = create<SessionRestoreStore>((set, get) => ({
  bootSessionSnapshot: null,

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await getSettingsSnapshot()
    const session = restorableSessionStateFromSettingsSnapshot(snap)
    if (version !== hydrateVersion) return session
    set({ bootSessionSnapshot: session })
    return session
  },

  consumeBootSessionSnapshot(): SessionState {
    const snapshot: SessionState = get().bootSessionSnapshot ?? DEFAULT_RESTORABLE_SESSION_STATE
    set((s) => (s.bootSessionSnapshot === null ? s : { bootSessionSnapshot: null }))
    return snapshot
  },
}))
