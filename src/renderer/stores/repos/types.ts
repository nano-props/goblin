import type { StoreApi } from 'zustand'
import type { BranchInfo, LogEntry, WorktreeStatus } from '#/renderer/types.ts'
import type { CommitDetail } from '#/renderer/types-bridge.ts'

export type DetailTab = 'status' | 'changes' | 'commits'

export interface BranchLogState {
  entries: LogEntry[]
  selectedHash: string | null
  loading: boolean
}

export type RepoEvent =
  | { id: number; kind: 'result'; result: { ok: boolean; message: string } }
  | { id: number; kind: 'error'; message: string }

/** Discriminated union: a successful open guarantees `id`; a failed
 *  open carries a translation key or raw message. The shape forces
 *  callers to narrow before reading either field. */
export type OpenRepoResult = { ok: true; id: string } | { ok: false; message: string }

export interface RepoState {
  /** Absolute repo root — also the unique id. */
  id: string
  name: string
  /** Bumped on every fresh open so async writers can detect close-and-reopen. */
  instanceToken: number
  branches: BranchInfo[]
  currentBranch: string
  selectedBranch: string | null
  logsByBranch: Record<string, BranchLogState>
  /** Working-tree status grouped by worktree (main worktree first). */
  status: WorktreeStatus[]
  statusLoading: boolean
  statusLoaded: boolean
  statusError: string | null
  detailTab: DetailTab
  /** When set, the log view shows the commit detail overlay. */
  openCommit: CommitDetail | null
  openingCommitHash: string | null
  loading: boolean
  syncing: boolean
  /** True while a periodic background fetch is running — header indicator. */
  fetching: boolean
  /** True if the most recent background fetch failed (network down,
   *  remote refused, etc). Cleared on next success. UI badges this. */
  fetchFailed: boolean
  /** Last fetch failure message — populated when fetchFailed flips
   *  true. Surfaced as the title of the red badge so the user can
   *  hover and read why fetch is failing instead of just seeing a
   *  red dot. */
  fetchError: string | null
  pullRequestsLoading: boolean
  pullRequestsRequestId: number
  events: RepoEvent[]
}

export interface MissingRepo {
  path: string
  reason: string
}

export interface ReposStore {
  repos: Record<string, RepoState>
  order: string[]
  activeId: string | null
  /** Hydration flag — true once boot session is restored, so we don't
   *  overwrite the saved session with an empty one before restore. */
  sessionReady: boolean
  /** Paths from the previous session that didn't probe successfully on
   *  hydrate (folder moved/deleted, external drive not mounted). The
   *  tab strip surfaces them so the user knows why their tabs didn't all
   *  come back, and offers a "forget" action to remove them from the
   *  saved session. */
  missingFromSession: MissingRepo[]
  detailCollapsed: boolean

  /** Add a repo to the store. By default also focuses it — pass
   *  `activate: false` for batch flows (e.g. multi-folder drop) that
   *  want to choose the final selection themselves to avoid the active
   *  tab flashing through every entry. Returns the resolved repo id
   *  (the toplevel git root) on success so callers can drive a final
   *  `setActive` without re-reading the store. */
  openRepo: (path: string, options?: { activate?: boolean }) => Promise<OpenRepoResult>
  closeRepo: (id: string) => void
  setActive: (id: string) => void
  /** Reorder the tab strip so `fromId` lands at `toId`'s position, using
   *  the same shift semantics as dnd-kit's `arrayMove` (the rest of the
   *  list closes the gap; later items shift up if `from < to`, down if
   *  `from > to`). No-op if either id is unknown or they're identical. */
  reorderRepos: (fromId: string, toId: string) => void
  setDetailTab: (id: string, tab: DetailTab) => void
  setDetailCollapsed: (collapsed: boolean) => void
  toggleDetailCollapsed: () => void
  selectBranch: (id: string, branch: string) => void
  selectLog: (id: string, branch: string, hash: string) => void
  cycleActive: (direction: 1 | -1) => void
  /** Keyboard-driven checkout of the active repo's selected branch.
   *  Centralizes the eligibility checks the keyboard hook used to do. */
  checkoutSelected: () => Promise<void>
  /** Keyboard-driven open of the active repo's selected log entry. */
  openSelectedCommit: () => Promise<void>
  refreshSnapshot: (
    id: string,
    options?: { silent?: boolean; skipLogBackfill?: boolean; token?: number },
  ) => Promise<void>
  refreshBranchLog: (id: string, branch?: string, options?: { token?: number }) => Promise<void>
  refreshPullRequests: (id: string, branches?: string[], options?: { token?: number }) => Promise<void>
  refreshStatus: (id: string, options?: { token?: number }) => Promise<void>
  refreshAll: (id: string, options?: { token?: number }) => Promise<void>
  syncAndRefresh: (id: string, options?: { token?: number }) => Promise<void>
  backgroundFetch: (id: string) => Promise<void>

  openCommit: (id: string, hash: string) => Promise<void>
  closeCommit: (id: string) => void

  setLastResult: (id: string, result: { ok: boolean; message: string }, token?: number) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateSession: (openRepos: string[], activeRepo: string | null) => Promise<void>
  /** Drop the "missing" indicator for paths that failed to restore — the
   *  user has acknowledged them. */
  dismissMissing: () => void
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, token?: number) => void
}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
