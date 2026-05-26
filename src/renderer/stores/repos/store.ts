// Multi-repo state. Each opened directory is a Repo identified by its
// absolute path (the toplevel returned by `git rev-parse --show-toplevel`,
// so opening a subdirectory dedupes against an already-open root).
//
// `order` controls top tab strip order; `activeId` is the visible
// repo on the right. Per-repo data (branches, log, status, worktrees,
// commit detail) lives inside `repos[id]` so each tab keeps its own
// scroll/selection state when the user flips between them.
//
// Race-condition defenses
//   - `instanceToken`: every time a repo is created/reset we mint a new
//     token. Async writers capture the token at call time and bail when
//     they observe a different token in `set()` — this guards against
//     a stale snapshot from before close-and-reopen overwriting fresh
//     data, and against late commit-detail / log responses landing in
//     the wrong repo.
//   - selection guards: branch log state is keyed by branch; same idea
//     for commit detail state.
//   - `inFlightFetchById`: `backgroundFetch` won't double-fire for the
//     same repo, no matter how often `App.tsx`'s effect re-runs.

import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { createBranchActions } from '#/renderer/stores/repos/branch-actions.ts'
import { createCommitActions } from '#/renderer/stores/repos/commit.ts'
import { createLifecycleActions } from '#/renderer/stores/repos/lifecycle.ts'
import { createRefreshActions } from '#/renderer/stores/repos/refresh.ts'
import { createSelectionActions } from '#/renderer/stores/repos/selection.ts'
import { normalizeRepoCache } from '#/renderer/stores/repos/persistence.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
} from '#/shared/workspace-layout.ts'
import type { CachedRepoState, ReposStore } from '#/renderer/stores/repos/types.ts'

interface PersistedReposStore {
  repoCache: Record<string, CachedRepoState>
}

interface RawPersistedReposStore {
  repoCache?: unknown
}

let lastStoredRepoCacheRef: Record<string, CachedRepoState> | undefined
let lastStoredReposJson: string | undefined

const repoStorage: PersistStorage<PersistedReposStore, void> = {
  getItem: (name) => {
    try {
      const raw = getStorage()?.getItem(name)
      if (!raw) {
        lastStoredRepoCacheRef = undefined
        lastStoredReposJson = undefined
        return null
      }
      const parsed = JSON.parse(raw) as StorageValue<RawPersistedReposStore>
      const repoCache = normalizeRepoCache(parsed.state?.repoCache)
      const value = { state: { repoCache }, version: parsed.version }
      lastStoredRepoCacheRef = repoCache
      lastStoredReposJson = JSON.stringify(value)
      return value
    } catch (err) {
      lastStoredRepoCacheRef = undefined
      lastStoredReposJson = undefined
      console.warn(`[repos] failed to read persisted store ${name}:`, err)
      return null
    }
  },
  setItem: (name, value) => {
    const repoCache = value.state.repoCache
    if (lastStoredReposJson !== undefined && repoCache === lastStoredRepoCacheRef) return
    const serialized = JSON.stringify(value)
    if (serialized === lastStoredReposJson) {
      lastStoredRepoCacheRef = repoCache
      return
    }
    const storage = getStorage()
    if (!storage) return
    try {
      storage.setItem(name, serialized)
      lastStoredRepoCacheRef = repoCache
      lastStoredReposJson = serialized
    } catch (err) {
      console.warn(`[repos] failed to persist store ${name}:`, err)
    }
  },
  removeItem: (name) => {
    const storage = getStorage()
    if (!storage) return
    try {
      storage.removeItem(name)
      lastStoredRepoCacheRef = undefined
      lastStoredReposJson = undefined
    } catch (err) {
      console.warn(`[repos] failed to remove persisted store ${name}:`, err)
    }
  },
}

export const useReposStore = create<ReposStore>()(
  persist(
    (set, get) => ({
      repos: {},
      repoCache: {},
      order: [],
      activeId: null,
      sessionReady: false,
      missingFromSession: [],
      branchSearchQueries: {},
      detailCollapsed: DEFAULT_DETAIL_COLLAPSED,
      detailFocusMode: false,
      workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
      detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,

      ...createLifecycleActions(set, get),
      ...createSelectionActions(set, get),
      ...createRefreshActions(set, get),
      ...createBranchActions(set, get),
      ...createCommitActions(set, get),
    }),
    {
      name: 'goblin.repo-store.v1',
      storage: repoStorage,
      partialize: (state): PersistedReposStore => ({ repoCache: state.repoCache }),
      merge: (persisted, current) => ({
        ...current,
        repoCache: normalizeRepoCache((persisted as RawPersistedReposStore | null)?.repoCache),
      }),
    },
  ),
)

function getStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
}
