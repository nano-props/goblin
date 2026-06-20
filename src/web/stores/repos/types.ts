import type { StoreApi } from 'zustand'
import type {
  BranchSnapshotInfo,
  BrowserRemoteProvider,
  ExecResult,
  GitRemoteInfo,
  PullRequestFetchMode,
  WorktreeStatus,
} from '#/web/types.ts'
import type { RemoteRepoLifecycle, RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneSizes } from '#/shared/workspace-layout.ts'
import type { SessionState } from '#/shared/api-types.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/repos/operations.ts'
import type { RepoResourcesState } from '#/web/stores/repos/resources.ts'
export type BranchViewMode = 'all' | 'worktrees'
export type RepoWorkspaceLayout = 'left-right'
export type RepoDataSource = 'cache' | 'fresh'
// Renderer branches keep only the worktree reference; metadata lives in worktreesByPath.
export type RepoBranchState = Omit<BranchSnapshotInfo, 'worktree'> & {
  worktree?: Pick<NonNullable<BranchSnapshotInfo['worktree']>, 'path'>
}

export type RepoEventAction =
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
  branches: RepoBranchState[]
  currentBranch: string
  currentHEAD?: string
  status: WorktreeStatus[]
  statusLoaded: boolean
  worktreesByPath: Record<string, RepoWorktreeState>
}

export interface RepoWorktreeState {
  path: string
  branch?: string
  isMain: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
}

export interface RepoUiState {
  selectedBranch: string | null
  branchViewMode: BranchViewMode
  /**
   * Branch-scoped workspace pane views opened for the selected branch.
   * Worktree-scoped views live in the terminal/workspace-pane runtime because
   * they are keyed by worktreePath; branch-scoped views stay with repo UI
   * state because they are keyed by selectedBranch.
   */
  openBranchWorkspacePaneViews: WorkspacePaneBranchViewType[]
  /** The user-preferred workspace pane view type. This is persisted intent; the
   *  rendered workspace pane is resolved at read time from this preference plus
   *  live worktree, terminal, and opened workspace pane view state. The store never
   *  adjusts this on snapshot/branch changes, preserving the user's
   *  preference across them. */
  preferredWorkspacePaneView: WorkspacePaneView
}

export interface RepoProjectionMeta {
  source: RepoDataSource
  savedAt: number | null
}

export interface RepoRemoteState {
  /**
   * Single source-of-truth lifecycle for a remote repo. `null` for local
   * repos. The lifecycle union owns `target` — code MUST read the target
   * from `lifecycle.target` (ready / failed-with-target). The legacy
   * `target?: RemoteRepoTarget` field has been removed in Phase 4 of the
   * remote-repo refactor; new code should call `remoteRepoTarget(repo)`
   * from `web/stores/repos/helpers.ts` instead of reaching into
   * `repo.remote.target`.
   */
  lifecycle: RemoteRepoLifecycle | null
  remotes?: string[]
  remoteDetails?: GitRemoteInfo[]
  hasRemotes?: boolean
  hasBrowserRemote?: boolean
  browserRemoteProvider?: BrowserRemoteProvider
  remoteProviders?: Record<string, BrowserRemoteProvider>
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

export type RepoAvailabilityState = { phase: 'available' } | { phase: 'unavailable'; reason: string; checkedAt: number }

export interface RestorableRepoSnapshot {
  savedAt: number
  name: string
  data: Pick<RepoDataState, 'branches' | 'currentBranch'>
  ui: Pick<RepoUiState, 'selectedBranch' | 'branchViewMode'>
}

export interface RepoState {
  /** Absolute repo root — also the unique id. */
  id: string
  name: string
  /** Bumped on every fresh open so async writers can detect close-and-reopen. */
  instanceToken: number
  /** Renderer-local projection of runtime-coherent repo truth. */
  data: RepoDataState
  resources: RepoResourcesState
  operations: RepoOperationsState
  ui: RepoUiState
  projection: RepoProjectionMeta
  remote: RepoRemoteState
  availability: RepoAvailabilityState
  events: RepoEvent[]
}

export interface RuntimeCoherentRepoProjectionState {
  /** Renderer-local projection of runtime-coherent repo state. */
  repos: Record<string, RepoState>
}

export interface RestorableRepoCacheState {
  /** Warm-start cache used only for restore. This is not runtime-coherent shared state. */
  restorableRepoCache: Record<string, RestorableRepoSnapshot>
}

export interface RestorableWorkspaceState {
  /** Renderer workspace UI state that is serialized into SessionState for
   *  next-launch restore. This is restorable state, not runtime-coherent
   *  shared state. */
  /** Workspace tab order restored from SessionState.openRepos. */
  order: string[]
  /** Active workspace tab restored from SessionState.activeRepo. */
  activeId: string | null
  /** Large-screen Focus Mode restored from SessionState. Compact UI is stronger and always shows one pane at a time. */
  workspaceFocused: boolean
  workspacePaneSizes: WorkspacePaneSizes
  /** Per worktree terminal selection restored from SessionState.selectedTerminalByWorktree. */
  selectedTerminalByWorktree: Record<string, string>
  /** Per-repo workspace pane view selection, restored with the session. */
  workspacePaneViewByRepo: Record<string, WorkspacePaneView>
}

export interface LocalWorkspaceState {
  /** Renderer-only workspace UI state that should never be serialized into
   *  SessionState or treated as restorable workspace state. */
  /** Hydration flag — true once boot session is restored, so we don't
   *  overwrite the saved session with an empty one before restore. */
  sessionReady: boolean
}

export interface RestorableWorkspaceActions {
  setActive: (id: string) => void
  /** Reorder the tab strip so `fromId` lands at `toId`'s position, using
   *  the same shift semantics as dnd-kit's `arrayMove` (the rest of the
  *  list closes the gap; later items shift up if `from < to`, down if
  *  `from > to`). No-op if either id is unknown or they're identical. */
  reorderRepos: (fromId: string, toId: string) => void
  applySessionLayoutState: (layout: Pick<SessionState, 'workspaceFocused' | 'workspacePaneSizes'>) => void
  applySessionSelectedTerminalState: (selectedTerminalByWorktree: Record<string, string>) => void
  applySessionWorkspacePaneViewByRepo: (workspacePaneViewByRepo: Record<string, WorkspacePaneView>) => void
  setWorkspaceFocused: (enabled: boolean) => void
  toggleWorkspaceFocused: () => void
  setWorkspacePaneSize: (layout: RepoWorkspaceLayout, size: number) => void
  setWorkspacePaneSizes: (sizes: WorkspacePaneSizes) => void
  resetLayout: () => void
  setSelectedTerminal: (worktreeTerminalKey: string, key: string | null) => void
  cycleActive: (direction: 1 | -1) => void
}

export interface RuntimeCoherentRepoProjectionActions {
  /** Ensure a repo belongs to the open workspace set without implying
   *  anything about the current active selection. */
  ensureWorkspaceOpen: (path: string | RepoSessionEntry) => Promise<OpenRepoResult>
  closeRepo: (id: string) => void
  /**
   * Re-probe a remote repo's lifecycle. The single user-facing
   * entry point for "retry" (and the only path the
   * `useNetworkReconnect` hook calls to recover from a failed
   * lifecycle). Safe to call regardless of the current lifecycle
   * phase — the orchestrator flips to `connecting` and re-runs.
   * Returns the new outcome, or `null` for non-remote ids.
   */
  retryRemoteRepoLifecycle: (id: string) => Promise<{ ok: boolean; reason?: string } | null>
  /** Updates the user-preferred workspace pane view type. The store does not project
   *  against terminal session count, worktree presence, or opened workspace pane views;
   *  the UI resolves the active pane at read time so session restore and branch
   *  switches preserve user intent. */
  setWorkspacePaneView: (id: string, tab: WorkspacePaneView) => void
  openBranchWorkspacePaneView: (id: string, tab: WorkspacePaneBranchViewType) => void
  closeBranchWorkspacePaneView: (id: string, tab: WorkspacePaneBranchViewType) => void
  setBranchViewMode: (id: string, viewMode: BranchViewMode) => void
  selectBranch: (id: string, branch: string) => void
  clearSelectedBranch: (id: string) => void
  refreshSnapshot: (id: string, options?: { skipLogBackfill?: boolean; token?: number }) => Promise<void>
  refreshSnapshotAndStatus: (id: string, options?: { skipLogBackfill?: boolean; token?: number }) => Promise<void>
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
  refreshCoreData: (id: string, options?: { token?: number }) => Promise<void>
  syncAndRefresh: (id: string, options?: { token?: number }) => Promise<void>
  setLastResult: (
    id: string,
    result: { ok: boolean; message: string },
    token: number,
    options?: RepoResultEventOptions,
  ) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateSession: (openRepos: RepoSessionEntry[], activeRepo: string | null, signal?: AbortSignal) => Promise<void>
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, token: number) => void
}

export interface RepoMutationActions {
  runBranchAction: (
    id: string,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<ExecResult | null>
  /** Fire-and-forget submission for branch actions whose UI should close
   *  immediately and let repo activity/toasts carry completion. This only
   *  triggers submission; callers should not treat it as accepted/completed. */
  submitBranchAction: (id: string, action: RepoBranchAction, options?: RunBranchActionOptions) => void
}

export interface ReposStore
  extends
    RuntimeCoherentRepoProjectionState,
    RestorableRepoCacheState,
    RestorableWorkspaceState,
    LocalWorkspaceState,
    RestorableWorkspaceActions,
    RuntimeCoherentRepoProjectionActions,
    RepoMutationActions {}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
