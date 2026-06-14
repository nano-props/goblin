// Per-repo terminal-session sync bookkeeping.
//
// The provider records when a repo's terminal session list has been refreshed
// and gates the focus-driven re-sync behind a cooldown to keep window
// focus thrash from spamming the server. Consumers read whether a given repo
// is currently marked ready for the live instanceToken.
//
// This is runtime-coherent UI state (renderer-local projection of sync
// progress), so it lives alongside the other runtime-coherent stores
// (theme, i18n, repos, session-restore) under src/web/stores/.

import { create } from 'zustand'

const DEFAULT_COOLDOWN_MS = 2000

interface RepoSyncState {
  /** Minimum gap between two markReady timestamps before shouldSync returns true. */
  cooldownMs: number
  /** repoRoot -> instanceToken recorded by the latest successful sync. */
  ready: Map<string, number>
  /** repoRoot -> ms-since-epoch recorded by the latest successful sync. */
  timestamps: Map<string, number>
  markReady: (repoRoot: string, instanceToken: number) => void
  shouldSync: (repoRoot: string) => boolean
}

export const useRepoSyncStore = create<RepoSyncState>((set, get) => ({
  cooldownMs: DEFAULT_COOLDOWN_MS,
  ready: new Map(),
  timestamps: new Map(),
  markReady: (repoRoot, instanceToken) => {
    if (get().ready.get(repoRoot) === instanceToken) return
    set((s) => {
      const ready = new Map(s.ready)
      ready.set(repoRoot, instanceToken)
      const timestamps = new Map(s.timestamps)
      timestamps.set(repoRoot, Date.now())
      return { ready, timestamps }
    })
  },
  shouldSync: (repoRoot) => {
    const last = get().timestamps.get(repoRoot) ?? 0
    return Date.now() - last >= get().cooldownMs
  },
}))
