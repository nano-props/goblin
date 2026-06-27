import type { StoreApi } from 'zustand'
import type {
  BranchSnapshotInfo,
  BrowserRemoteProvider,
  ExecResult,
  GitRemoteInfo,
  PullRequestFetchMode,
  WorktreeStatus,
} from '#/web/types.ts'
import type { RemoteRepoConnectionLifecycle, RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspaceSessionState } from '#/shared/api-types.ts'
import type {
  WorkspacePaneSessionTabType,
  WorkspacePaneStaticTabType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/repos/operations.ts'
import type { RepoDataLoadBundle, RepoDataLoadState } from '#/web/stores/repos/repo-data-load-state.ts'
export type BranchViewMode = 'all' | 'worktrees'
type RepoDataSource = 'cache' | 'fresh'
// Client branches keep only the worktree reference; metadata lives in worktreesByPath.
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
  | { id: number; kind: 'result'; result: ExecResult; action?: RepoEventAction }
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
   * Single branch-scoped workspace pane tab strip order. Static tab entries
   * are the opened static tabs; terminal entries are ordering hints for live
   * terminal sessions, whose lifecycle remains terminal-runtime owned.
   */
  workspacePaneTabOrderByBranch: Record<string, WorkspacePaneTabOrderEntry[]>
  /** Branch-scoped selected workspace pane tab. Branch switches read this
   *  first so selecting a tab on one branch does not select it on another. */
  preferredWorkspacePaneTabByBranch: Record<string, WorkspacePaneTabType>
  /**
   * Per-branch hint about the most recent user-initiated workspace pane tab
   * close. Set by `setLastClosedTabContext` after `runCloseWorkspacePaneTabCommand`
   * commits. Read by `createRepoWorkspaceTabModel` to prefer the spatial
   * neighbor of the closed tab over the generic tabs[0] fallback when the
   * preferred tab becomes unrenderable, and also when the closed tab was the
   * active tab so the workspace pane does not jump to a different remaining
   * terminal instead of the adjacent tab. Overwritten by the next close on the
   * same branch.
   *
   * Runtime-coherent only: not persisted to WorkspaceSessionState and not restored on
   * relaunch. A fresh session starts with an empty record; the first user
   * close populates it for that branch. Context is cleared by explicit
   * selection/tab-order changes so a stale close hint cannot override later
   * user intent.
   */
  lastClosedTabContextByBranch: Record<
    string,
    {
      closingIdentity: string
      /** Pre-close tab identities in tab order. Sufficient for the model
       *  to compute adjacency without storing the full tab model. */
      previousTabIdentities: readonly string[]
      /** True when the closed tab was the active tab at the moment of close.
       *  The model uses this to prefer the spatial neighbor even if the user's
       *  preferred tab (e.g. terminal) remains renderable via another tab. */
      wasActive?: boolean
    } | null
  >
}

interface RepoProjectionMeta {
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
   * from `web/stores/repos/repo-guards.ts` instead of reaching into
   * `repo.remote.target`.
   */
  lifecycle: RemoteRepoConnectionLifecycle | null
  remotes?: string[]
  remoteDetails?: GitRemoteInfo[]
  hasRemotes?: boolean
  hasBrowserRemote?: boolean
  browserRemoteProvider?: BrowserRemoteProvider
  remoteProviders?: Record<string, BrowserRemoteProvider>
  hasGitHubRemote?: boolean
  /** Sticky connectivity badge for background fetch failures. Unlike
   *  `dataLoads.fetch.error`, this persists after the operation settles and
   *  is cleared by the next successful network operation. */
  fetchFailed: boolean
  /** Last fetch failure message — populated when fetchFailed flips
   *  true. Surfaced as the title of the red badge so the user can
   *  hover and read why fetch is failing instead of just seeing a
   *  red dot. */
  fetchError: string | null
}

type RepoAvailabilityState = { phase: 'available' } | { phase: 'unavailable'; reason: string; checkedAt: number }

export interface RepoSnapshotCacheEntry {
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
  /** Client-local projection of runtime-coherent repo truth. */
  data: RepoDataState
  dataLoads: RepoDataLoadBundle
  operations: RepoOperationsState
  ui: RepoUiState
  projection: RepoProjectionMeta
  remote: RepoRemoteState
  availability: RepoAvailabilityState
  events: RepoEvent[]
}

export interface RuntimeCoherentRepoProjectionState {
  /** Client-local projection of runtime-coherent repo state. */
  repos: Record<string, RepoState>
}

interface RepoSnapshotCacheState {
  /** Warm-start cache used only for restore. This is not runtime-coherent shared state. */
  repoSnapshotCache: Record<string, RepoSnapshotCacheEntry>
}

export interface RestorableWorkspaceState {
  /** Client workspace UI state that is serialized into WorkspaceSessionState for
   *  next-launch restore. This is restorable state, not runtime-coherent
   *  shared state. */
  /** Open repository order restored from WorkspaceSessionState.openRepoEntries. */
  order: string[]
  /** Active repository restored from WorkspaceSessionState.activeRepoId. */
  activeId: string | null
  /** Large-screen Zen Mode restored from WorkspaceSessionState. Compact UI is stronger and always shows one pane at a time. */
  zenMode: boolean
  workspacePaneSize: number
  /** Per worktree terminal selection restored from WorkspaceSessionState.selectedTerminalSessionByWorktree. */
  selectedTerminalSessionByWorktree: Record<string, string>
}

export interface SessionWorkspacePaneRestoreState {
  workspacePaneTabOrderByBranchByRepo: Record<string, Record<string, WorkspacePaneTabOrderEntry[]>>
  preferredWorkspacePaneTabByBranchByRepo: Record<string, Record<string, WorkspacePaneSessionTabType>>
}

export interface RepoSessionHydrationOptions {
  signal?: AbortSignal
  workspacePaneRestoreState?: SessionWorkspacePaneRestoreState
}

interface LocalWorkspaceState {
  /** Client-only workspace UI state that should never be serialized into
   *  WorkspaceSessionState or treated as restorable workspace state. */
  /** Hydration flag — true once boot session is restored, so we don't
   *  overwrite the saved session with an empty one before restore. */
  sessionReady: boolean
}

interface RestorableWorkspaceActions {
  setActive: (id: string) => void
  applySessionLayoutState: (layout: Pick<WorkspaceSessionState, 'zenMode' | 'workspacePaneSize'>) => void
  applySessionSelectedTerminalState: (selectedTerminalSessionByWorktree: Record<string, string>) => void
  setZenMode: (enabled: boolean) => void
  toggleZenMode: () => void
  setWorkspacePaneSize: (size: number) => void
  resetLayout: () => void
  setSelectedTerminal: (worktreeTerminalKey: string, key: string | null) => void
  cycleActive: (direction: 1 | -1) => void
}

interface RuntimeCoherentRepoProjectionActions {
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
  retryRemoteRepoConnection: (id: string) => Promise<{ ok: boolean; reason?: string } | null>
  /** Updates the selected branch's workspace pane tab type. The store does not project
   *  against terminal session count, worktree presence, or opened workspace pane tabs;
   *  the UI resolves the active pane at read time so session restore preserves
   *  branch-scoped user intent. */
  setWorkspacePaneTab: (id: string, tab: WorkspacePaneTabType) => void
  openWorkspacePaneStaticTab: (id: string, tab: WorkspacePaneStaticTabType, branchName?: string) => void
  closeWorkspacePaneStaticTab: (id: string, tab: WorkspacePaneStaticTabType, branchName?: string) => void
  addWorkspacePaneTerminalTab: (id: string, terminalKey: string, branchName?: string) => void
  addAndFocusWorkspacePaneTerminalTab: (id: string, terminalKey: string, branchName?: string) => void
  removeWorkspacePaneTerminalTab: (id: string, terminalKey: string, branchName?: string) => void
  reorderWorkspacePaneTabs: (id: string, orderedTabs: WorkspacePaneTabOrderEntry[], branchName?: string) => void
  /** Records the most recent user-initiated close on a branch so the
   *  workspace pane tab model can prefer the spatial neighbor of the
   *  closed tab when the preferred tab becomes unrenderable or when the
   *  closed tab was the active tab. The pre-close tab identities carry
   *  enough information for the model to compute the neighbor without the
   *  command imperatively re-selecting anything. */
  setLastClosedTabContext: (
    id: string,
    branchName: string,
    context: { closingIdentity: string; previousTabIdentities: readonly string[]; wasActive?: boolean },
  ) => void
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
  setLastResult: (id: string, result: ExecResult, token: number, options?: RepoResultEventOptions) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateRepoSession: (
    openRepoEntries: RepoSessionEntry[],
    activeRepoId: string | null,
    options?: RepoSessionHydrationOptions,
  ) => Promise<void>
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, token: number) => void
}

interface RepoMutationActions {
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
    RepoSnapshotCacheState,
    RestorableWorkspaceState,
    LocalWorkspaceState,
    RestorableWorkspaceActions,
    RuntimeCoherentRepoProjectionActions,
    RepoMutationActions {}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
