// Multi-workspace client state. Each opened filesystem root is a Workspace
// identified by its canonical workspace id. Git repositories enrich that
// workspace with repo projections; plain directories do not need Git.
//
// `workspaceOrder` controls workspace switcher order; `restoredWorkspaceId` is the workspace
// restored from the previous session for `/` startup routing. Route state owns
// the workspace currently visible on the right. `workspaces[id]` owns the client
// shell, UI intent, operations, loading metadata, and session-local state. Git
// domain read data such as branches, status, and worktrees is server/React
// Query authoritative and is composed into presentation models at the UI edge.
//
// Race-condition defenses
//   - `workspaceRuntimeId`: every time a workspace is created/reset we mint a new
//     id. Async writers capture the id at call time and bail when
//     they observe a different id in `set()` — this guards against
//     a stale snapshot from before close-and-reopen overwriting fresh
//     data in the wrong workspace.
import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import { createBranchActions } from '#/web/stores/workspaces/branch-actions.ts'
import { createCommitActions } from '#/web/stores/workspaces/commit.ts'
import { createWorkspaceSessionActions } from '#/web/stores/workspaces/workspace-session.ts'
import { createSelectionActions } from '#/web/stores/workspaces/selection.ts'
import { createTabOpenerActions } from '#/web/stores/workspaces/tab-opener.ts'
import { workspacesLog } from '#/web/logger.ts'
import { normalizeRepoSnapshotCache } from '#/web/stores/workspaces/persistence.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type { RepoSnapshotCacheEntry, WorkspacesStore } from '#/web/stores/workspaces/types.ts'

interface PersistedWorkspacesStore {
  repoSnapshotCache: Record<string, RepoSnapshotCacheEntry>
}

interface RawPersistedWorkspacesStore {
  repoSnapshotCache?: unknown
}

let lastStoredRepoCacheRef: Record<string, RepoSnapshotCacheEntry> | undefined
let lastStoredReposJson: string | undefined

const repoStorage: PersistStorage<PersistedWorkspacesStore, void> = {
  getItem: (name) => {
    try {
      const raw = getStorage()?.getItem(name)
      if (!raw) {
        lastStoredRepoCacheRef = undefined
        lastStoredReposJson = undefined
        return null
      }
      const parsed = JSON.parse(raw) as StorageValue<RawPersistedWorkspacesStore>
      const repoSnapshotCache = normalizeRepoSnapshotCache(parsed.state?.repoSnapshotCache)
      const value = { state: { repoSnapshotCache }, version: parsed.version }
      lastStoredRepoCacheRef = repoSnapshotCache
      lastStoredReposJson = JSON.stringify(value)
      return value
    } catch (err) {
      lastStoredRepoCacheRef = undefined
      lastStoredReposJson = undefined
      workspacesLog.warn(`failed to read persisted store ${name}`, { err })
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
      workspacesLog.warn(`failed to persist store ${name}`, { err })
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
      workspacesLog.warn(`failed to remove persisted store ${name}`, { err })
    }
  },
}

export const useWorkspacesStore = create<WorkspacesStore>()(
  persist(
    (set, get) => ({
      // Runtime-coherent client projection.
      workspaces: {},

      // Restorable warm-start cache.
      repoSnapshotCache: {},

      // Restorable workspace state.
      workspaceOrder: [],
      restoredWorkspaceId: null,
      zenMode: DEFAULT_ZEN_MODE,
      workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
      selectedTerminalSessionIdByTerminalWorktree: {},

      // Local client-only state.
      workspaceMembershipReady: false,
      sessionPersistenceReady: false,
      sessionRestoreError: null,
      restoredClientWorkspaceBaseline: null,
      tabOpenerIdentityByScope: {},
      navigationHistoryByWorkspace: {},

      ...createWorkspaceSessionActions(set, get),
      ...createSelectionActions(set, get),
      ...createTabOpenerActions(set),
      ...createBranchActions(set, get),
      ...createCommitActions(set),
    }),
    {
      // The persisted payload is only the Git repo snapshot warm cache. Keep
      // its stable storage identity; workspace membership is restored by the server.
      name: 'goblin.repos-store',
      storage: repoStorage,
      partialize: (state): PersistedWorkspacesStore => ({ repoSnapshotCache: state.repoSnapshotCache }),
      merge: (persisted, current) => ({
        ...current,
        repoSnapshotCache: normalizeRepoSnapshotCache(
          (persisted as RawPersistedWorkspacesStore | null)?.repoSnapshotCache,
        ),
      }),
    },
  ),
)

function getStorage(): Storage | undefined {
  return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage
}
