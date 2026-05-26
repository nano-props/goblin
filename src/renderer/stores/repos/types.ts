import type { StoreApi } from 'zustand'
import type { BranchInfo, ExecResult, LogEntry, PullRequestFetchMode, WorktreeStatus } from '#/renderer/types.ts'
import type { CommitDetail } from '#/shared/rpc.ts'
import type { WorkspaceDetailPaneSizes, WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/renderer/stores/repos/branch-action-types.ts'
import type { RepoResourcesState } from '#/renderer/stores/repos/resources.ts'

export type DetailTab = 'status' | 'changes' | 'commits' | 'terminal'
export type BranchViewMode = 'all' | 'worktrees' | 'no-worktree'
export type RepoWorkspaceLayout = WorkspaceLayout
export type RepoDataSource = 'cache' | 'fresh'
export type CommitDetailState =
  | { phase: 'idle' }
  | { phase: 'opening'; hash: string }
  | { phase: 'open'; detail: CommitDetail }

export interface BranchLogState {
  entries: LogEntry[]
  selectedHash: string | null
  hasMore: boolean
}

export type RepoEventAction =
  | { kind: 'checkout'; branch: string }
  | { kind: 'pull'; branch: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createWorktree'; branch: string; worktreePath: string }
  | { kind: 'deleteBranch'; branch: string }
  | { kind: 'removeWorktree'; branch: string; worktreePath: string; alsoDeleteBranch: boolean }

export interface RepoResultEventOptions {
  action?: RepoEventAction
}

export type RepoEvent =
  | { id: number; kind: 'result'; result: { ok: boolean; message: string }; action?: RepoEventAction }
  | { id: number; kind: 'error'; message: string }

/** Discriminated union: a successful open guarantees `id`; a failed
 *  open carries a translation key or raw message. The shape forces
 *  callers to narrow before reading either field. */
export type OpenRepoResult = { ok: true; id: string } | { ok: false; message: string }

export interface RepoDataState {
  branches: BranchInfo[]
  currentBranch: string
  logsByBranch: Record<string, BranchLogState>
  status: WorktreeStatus[]
  statusLoaded: boolean
}

export interface RepoUiState {
  selectedBranch: string | null
  branchViewMode: BranchViewMode
  detailTab: DetailTab
  commitDetail: CommitDetailState
}

export interface RepoCacheState {
  source: RepoDataSource
  savedAt: number | null
}

export interface RepoRemoteState {
  remotes?: string[]
  hasRemotes?: boolean
  hasGitHubRemote?: boolean
  /** Sticky connectivity badge for background fetch failures. Unlike
   *  `resources.fetch.error`, this persists after the operation settles and
   *  is cleared by the next successful network operation. */
  fetchFailed: boolean
  /** Last fetch failure message — populated when fetchFailed flips
   *  true. Surfaced as the title of the red badge so the user can
   *  hover and read why fetch is failing instead of just seeing a
   *  red dot. */
  fetchError: string | null
}

export interface CachedRepoState {
  savedAt: number
  name: string
  data: Pick<RepoDataState, 'branches' | 'currentBranch' | 'status' | 'statusLoaded'>
  ui: Pick<RepoUiState, 'selectedBranch' | 'branchViewMode' | 'detailTab'>
}

export interface RepoState {
  /** Absolute repo root — also the unique id. */
  id: string
  name: string
  /** Bumped on every fresh open so async writers can detect close-and-reopen. */
  instanceToken: number
  data: RepoDataState
  resources: RepoResourcesState
  ui: RepoUiState
  cache: RepoCacheState
  remote: RepoRemoteState
  events: RepoEvent[]
}

export interface MissingRepo {
  path: string
  reason: string
}

export interface ReposStore {
  repos: Record<string, RepoState>
  repoCache: Record<string, CachedRepoState>
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
  branchSearchQueries: Record<string, string>
  detailCollapsed: boolean
  detailFocusMode: boolean
  workspaceLayout: RepoWorkspaceLayout
  detailPaneSizes: WorkspaceDetailPaneSizes

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
  dismissExitedTerminalDetail: (id: string, worktreePath: string) => void
  setDetailCollapsed: (collapsed: boolean) => void
  toggleDetailCollapsed: () => void
  setDetailFocusMode: (focused: boolean) => void
  toggleDetailFocusMode: () => void
  setWorkspaceLayout: (layout: RepoWorkspaceLayout) => void
  setDetailPaneSize: (layout: RepoWorkspaceLayout, size: number) => void
  setDetailPaneSizes: (sizes: WorkspaceDetailPaneSizes) => void
  resetLayout: () => void
  setBranchViewMode: (id: string, viewMode: BranchViewMode) => void
  setBranchSearchQuery: (id: string, query: string) => void
  selectBranch: (id: string, branch: string) => void
  selectLog: (id: string, branch: string, hash: string) => void
  cycleActive: (direction: 1 | -1) => void
  /** Keyboard-driven checkout of the active repo's selected branch.
   *  Centralizes the eligibility checks the keyboard hook used to do. */
  checkoutSelected: () => Promise<void>
  /** Keyboard-driven open of the active repo's selected log entry. */
  openSelectedCommit: () => Promise<void>
  refreshSnapshot: (id: string, options?: { skipLogBackfill?: boolean; token?: number }) => Promise<void>
  refreshBranchLog: (id: string, branch?: string, options?: { token?: number }) => Promise<void>
  loadMoreBranchLog: (id: string, branch?: string, options?: { token?: number }) => Promise<void>
  refreshPullRequests: (
    id: string,
    branches?: string[],
    options?: {
      token?: number
      mode?: PullRequestFetchMode
      clearMissing?: boolean
    },
  ) => Promise<void>
  refreshStatus: (id: string, options?: { token?: number }) => Promise<void>
  refreshAll: (id: string, options?: { token?: number }) => Promise<void>
  syncAndRefresh: (id: string, options?: { token?: number }) => Promise<void>
  backgroundFetch: (id: string) => Promise<void>
  runBranchAction: (
    id: string,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<ExecResult | null>

  openCommit: (id: string, hash: string) => Promise<void>
  closeCommit: (id: string) => void

  setLastResult: (id: string, result: { ok: boolean; message: string }, token: number, options?: RepoResultEventOptions) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateSession: (openRepos: string[], activeRepo: string | null) => Promise<void>
  /** Drop the "missing" indicator for paths that failed to restore — the
   *  user has acknowledged them. */
  dismissMissing: () => void
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, token: number) => void
}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
