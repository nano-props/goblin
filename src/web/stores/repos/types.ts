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
import type { WorkspaceDetailPaneSizes, WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { SessionState, DetailTab } from '#/shared/api-types.ts'
export type { DetailTab }
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/repos/operations.ts'
import type { RepoResourcesState } from '#/web/stores/repos/resources.ts'
export type BranchViewMode = 'all' | 'worktrees' | 'no-worktree'
export type RepoWorkspaceLayout = WorkspaceLayout
export type RepoDataSource = 'cache' | 'fresh'
// Renderer branches keep only the worktree reference; metadata lives in worktreesByPath.
export type RepoBranchState = Omit<BranchSnapshotInfo, 'worktree'> & {
  worktree?: Pick<NonNullable<BranchSnapshotInfo['worktree']>, 'path'>
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
  /** The user-preferred detail tab. This is the persisted intent; what the
   *  user actually sees is `computeEffectiveDetailTab(preferred, context)`
   *  evaluated at read time, where `context` carries the worktree, dirty
   *  state, and terminal session truth. The store never adjusts this on
   *  snapshot/branch changes — the derived value handles those cases,
   *  preserving the user's preference across them. */
  preferredDetailTab: DetailTab
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
  detailCollapsed: boolean
  /** Persisted focus-toggle preference for the top-bottom detail pane. This
   *  is not itself proof that the workspace is currently rendering in focus
   *  mode — a collapsed top-bottom layout preserves the preference while the
   *  effective layout mode remains collapsed. */
  detailFocusMode: boolean
  workspaceLayout: RepoWorkspaceLayout
  detailPaneSizes: WorkspaceDetailPaneSizes
  /** Per worktree terminal selection restored from SessionState.selectedTerminalByWorktree. */
  selectedTerminalByWorktree: Record<string, string>
  /** Per-repo detail tab selection, restored alongside detailCollapsed. */
  detailTabByRepo: Record<string, DetailTab>
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
  setDetailCollapsed: (collapsed: boolean) => void
  toggleDetailCollapsed: () => void
  /** Update the persisted top-bottom focus-toggle preference. The effective
   *  rendered layout mode should be derived from `repoWorkspaceBehavior()`. */
  setDetailFocusMode: (focused: boolean) => void
  toggleDetailFocusMode: () => void
  setWorkspaceLayout: (layout: RepoWorkspaceLayout) => void
  applySessionLayoutState: (
    layout: Pick<SessionState, 'workspaceLayout' | 'detailCollapsed' | 'detailFocusMode' | 'detailPaneSizes'>,
  ) => void
  applySessionSelectedTerminalState: (selectedTerminalByWorktree: Record<string, string>) => void
  applySessionDetailTabByRepo: (detailTabByRepo: Record<string, DetailTab>) => void
  setDetailPaneSize: (layout: RepoWorkspaceLayout, size: number) => void
  setDetailPaneSizes: (sizes: WorkspaceDetailPaneSizes) => void
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
  /** Updates the user-preferred detail tab. The store does not project
   *  against terminal session count or worktree presence — the UI computes
   *  the effective tab via `computeEffectiveDetailTab` at read time, which
   *  preserves user intent across session restore and branch switches. */
  setDetailTab: (id: string, tab: DetailTab) => void
  setBranchViewMode: (id: string, viewMode: BranchViewMode) => void
  selectBranch: (id: string, branch: string) => void
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
  checkoutSelectedInRepo: (id: string) => Promise<void>
  /** Keyboard-driven checkout of the active repo's selected branch.
   *  Centralizes the eligibility checks the keyboard hook used to do. */
  checkoutSelected: () => Promise<void>
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
