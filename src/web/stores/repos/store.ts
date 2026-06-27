// Multi-repo state. Each opened directory is a Repo identified by its
// absolute path (the toplevel returned by `git rev-parse --show-toplevel`,
// so opening a subdirectory dedupes against an already-open root).
//
// `order` controls repository switcher order; `activeId` is the visible
// repo on the right. Per-repo data (branches, log, status, worktrees,
// commit detail) lives inside `repos[id]` so each repo keeps its own
// scroll/selection state when the user flips between them.
//
// Race-condition defenses
//   - `instanceToken`: every time a repo is created/reset we mint a new
//     token. Async writers capture the token at call time and bail when
//     they observe a different token in `set()` — this guards against
//     a stale snapshot from before close-and-reopen overwriting fresh
//     data in the wrong repo.
import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { createBranchActions } from '#/web/stores/repos/branch-actions.ts'
import { createCommitActions } from '#/web/stores/repos/commit.ts'
import { createRepoSessionActions } from '#/web/stores/repos/repo-session.ts'
import { createRefreshActions } from '#/web/stores/repos/refresh.ts'
import { createSelectionActions } from '#/web/stores/repos/selection.ts'
import { reposLog } from '#/web/logger.ts'
import { normalizeRepoSnapshotCache } from '#/web/stores/repos/persistence.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { RepoSnapshotCacheEntry, ReposStore } from '#/web/stores/repos/types.ts'

interface PersistedReposStore {
  repoSnapshotCache: Record<string, RepoSnapshotCacheEntry>
}

interface RawPersistedReposStore {
  repoSnapshotCache?: unknown
}

let lastStoredRepoCacheRef: Record<string, RepoSnapshotCacheEntry> | undefined
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
      const repoSnapshotCache = normalizeRepoSnapshotCache(parsed.state?.repoSnapshotCache)
      const value = { state: { repoSnapshotCache }, version: parsed.version }
      lastStoredRepoCacheRef = repoSnapshotCache
      lastStoredReposJson = JSON.stringify(value)
      return value
    } catch (err) {
      lastStoredRepoCacheRef = undefined
      lastStoredReposJson = undefined
      reposLog.warn(`failed to read persisted store ${name}`, { err })
      return null
    }
  },
  setItem: (name, value) => {
    const repoSnapshotCache = value.state.repoSnapshotCache
    if (lastStoredReposJson !== undefined && repoSnapshotCache === lastStoredRepoCacheRef) return
    const serialized = JSON.stringify(value)
    if (serialized === lastStoredReposJson) {
      lastStoredRepoCacheRef = repoSnapshotCache
      return
    }
    const storage = getStorage()
    if (!storage) return
    try {
      storage.setItem(name, serialized)
      lastStoredRepoCacheRef = repoSnapshotCache
      lastStoredReposJson = serialized
    } catch (err) {
      reposLog.warn(`failed to persist store ${name}`, { err })
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
      reposLog.warn(`failed to remove persisted store ${name}`, { err })
    }
  },
}

export const useReposStore = create<ReposStore>()(
  persist(
    (set, get) => ({
      // Runtime-coherent client projection.
      repos: {},

      // Restorable warm-start cache.
      repoSnapshotCache: {},

      // Restorable workspace state.
      order: [],
      activeId: null,
      zenMode: DEFAULT_ZEN_MODE,
      workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
      selectedTerminalSessionByWorktree: {},

      // Local client-only state.
      sessionReady: false,

      ...createRepoSessionActions(set, get),
      ...createSelectionActions(set, get),
      ...createRefreshActions(set, get),
      ...createBranchActions(set, get),
      ...createCommitActions(set, get),
    }),
    {
      name: 'goblin.repos-store',
      storage: repoStorage,
      partialize: (state): PersistedReposStore => ({ repoSnapshotCache: state.repoSnapshotCache }),
      merge: (persisted, current) => ({
        ...current,
        repoSnapshotCache: normalizeRepoSnapshotCache((persisted as RawPersistedReposStore | null)?.repoSnapshotCache),
      }),
    },
  ),
)

function getStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
}
