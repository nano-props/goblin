import type { StoreApi } from 'zustand'
import type { BranchSnapshotInfo, BrowserRemoteProvider, ExecResult, GitRemoteInfo } from '#/web/types.ts'
import type { RemoteRepoConnectionLifecycle, RepoSessionEntry } from '#/shared/remote-repo.ts'
import type {
  ClientWorkspaceState,
  RepoWorkspaceTabsRestoreResult,
  WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/repos/operations.ts'
import type { RepoDataLoadBundle } from '#/web/stores/repos/repo-data-load-state.ts'
export type BranchViewMode = 'all' | 'worktrees'
type RepoDataSource = 'cache' | 'fresh'
export type RepoBranchState = Omit<BranchSnapshotInfo, 'worktree'> & {
  worktree?: Pick<NonNullable<BranchSnapshotInfo['worktree']>, 'path'>
}

export type RepoEventAction =
  | { kind: 'pull'; branch: string }
  | { kind: 'push'; branch: string }
  | { kind: 'createWorktree'; branch: string; worktreePath: string }
  | { kind: 'deleteBranch'; branch: string }
  | { kind: 'removeWorktree'; branch: string; worktreePath: string; deleteBranch: boolean }

export interface RepoResultEventOptions {
  action?: RepoEventAction
}

export type RepoEvent =
  | { id: number; kind: 'result'; result: ExecResult; action?: RepoEventAction }
  | { id: number; kind: 'error'; message: string }

/** Discriminated union: a successful open guarantees `id`; a failed
 *  open carries a translation key or raw message. The shape forces
 *  callers to narrow before reading either field. */
export interface OpenRepoPostOpenError {
  kind: 'recent-repo'
  message: string
}

export type OpenRepoResult =
  { ok: true; id: string; postOpenEffects?: Promise<OpenRepoPostOpenError[]> } | { ok: false; message: string }

export type CloseRepoResult = { ok: true } | { ok: false; message: string }

export interface RepoWorktreeState {
  path: string
  branch?: string
  isMain: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
}

export interface RepoUiState {
  branchViewMode: BranchViewMode
  /** Target-scoped selected workspace pane tab. Worktree-backed panes are keyed by
   *  worktree path; branch-only panes are keyed by branch name. `null` is an
   *  intentional empty workspace pane, not a missing preference. */
  preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType | null>
}

interface RepoProjectionMeta {
  source: RepoDataSource
  savedAt: number | null
}

export interface RepoRemoteState {
  /**
   * Single source-of-truth lifecycle for a remote repo. `null` for local
   * repos. The lifecycle union owns `target` — code MUST read the target
   * from `lifecycle.target` (ready / failed-with-target). Call
   * `remoteRepoTarget(repo)` from `web/stores/repos/repo-guards.ts`
   * instead of inferring target state from other remote fields.
   */
  lifecycle: RemoteRepoConnectionLifecycle | null
  /** Highest server-owned remote attempt accepted into this window projection. */
  lifecycleAttemptId: number | null
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

export type RepoSessionProjectionState = 'projected' | 'stub'

export interface RepoSessionState {
  /** Canonical session entry for the workspace shell. Remote stubs only know a
   *  ref, not a resolved target, so the entry must be preserved directly. */
  entry: RepoSessionEntry | null
  /** Whether target-scoped session state is client-owned yet. Stub repos keep
   *  the server baseline until the repo is projected on view. */
  projectionState: RepoSessionProjectionState
}

type RepoAvailabilityState = { phase: 'available' } | { phase: 'unavailable'; reason: string; checkedAt: number }

export interface RepoSnapshotCacheEntry {
  savedAt: number
  name: string
  data: {
    branches: RepoBranchState[]
    currentBranch: string
  }
  ui: Pick<RepoUiState, 'branchViewMode'>
}

export interface RepoState {
  /** Absolute repo root — also the unique id. */
  id: string
  name: string
  /** Current repo runtime authority for this repo; mirrors the runtime endpoint `repoRuntimeId`. */
  repoRuntimeId: string
  dataLoads: RepoDataLoadBundle
  operations: RepoOperationsState
  ui: RepoUiState
  projection: RepoProjectionMeta
  session: RepoSessionState
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
  /** Client workspace UI state that is serialized into ClientWorkspaceState for
   *  next-launch restore. This is restorable state, not runtime-coherent
   *  shared state. */
  /** Open repository order restored from the server workspace. */
  order: string[]
  /**
   * Session repo restored from ClientWorkspaceState.restoredRepoId.
   * The route owns the current repo.
   */
  restoredRepoId: string | null
  /** Large-screen Zen Mode restored from ClientWorkspaceState. Compact UI is stronger and always shows one pane at a time. */
  zenMode: boolean
  workspacePaneSize: number
  /** Per worktree terminal selection restored from ClientWorkspaceState.selectedTerminalSessionIdByTerminalWorktree. */
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>
}

export type WorkspaceNavigationHistoryRoute =
  | { kind: 'empty' }
  | { kind: 'dashboard' }
  | { kind: 'newWorktree'; returnTo: string | null }
  | {
      kind: 'branch'
      branchName: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalWorktreeKey: string | null
      terminalSessionId: string | null
    }

export interface WorkspaceNavigationHistoryEntry {
  repoId: string
  route: WorkspaceNavigationHistoryRoute
}

export interface WorkspaceNavigationHistoryRepoState {
  current: WorkspaceNavigationHistoryEntry | null
  backStack: WorkspaceNavigationHistoryEntry[]
  forwardStack: WorkspaceNavigationHistoryEntry[]
}

export interface WorkspaceNavigationHistoryTraversal {
  repoId: string
  direction: 'back' | 'forward'
  current: WorkspaceNavigationHistoryEntry
  target: WorkspaceNavigationHistoryEntry
}

export interface RepoWorkspaceHydrationOptions {
  signal?: AbortSignal
  restoredClientWorkspace?: ClientWorkspaceState
}

interface LocalWorkspaceState {
  /** Client-only workspace UI state that should never be serialized into
   *  ClientWorkspaceState or treated as restorable workspace state. */
  /** Workspace membership restore flag. True once boot workspace entries have
   *  produced the placeholder repo set (or proved there are no repos), so the
   *  workspace shell can render without overwriting the saved workspace with an
   *  empty one before restore. Repo content hydration may still be running. */
  workspaceMembershipReady: boolean
  /** Persistence gate — true only after all boot-restored state that can
   *  affect ClientWorkspaceState has converged back into the client store. */
  sessionPersistenceReady: boolean
  /** Boot restore failure that blocks session persistence. UI can render, but
   *  persisted workspace state must not be overwritten until the restore issue
   *  is resolved by a successful boot. */
  sessionRestoreError: string | null
  /** Client-owned state from boot restore, retained while repos remain stubs. */
  restoredClientWorkspaceBaseline: ClientWorkspaceState | null
  /** Chrome-tab-style "opener" tracking, covering every workspace pane tab
   *  (static and terminal): maps a tab's identity (see
   *  `workspacePaneTabEntryIdentity`) to the identity of the tab that was
   *  active when it was opened. Closing a tab prefers reactivating its
   *  opener before falling back to the adjacent-tab heuristic. Scoped by the
   *  same workspace pane target identity as tab-list projection and selected
   *  pane preference because static tab identities (e.g.
   *  `workspace-pane:changes`) are shared constants across every target,
   *  unlike terminal identities. Session-local only — openers don't need to
   *  survive reload/restart. */
  tabOpenerIdentityByScope: Record<string, Record<string, string>>
  /** Session-only app navigation history, scoped by repo. The route owns
   *  the visible repo/branch, while this store keeps enough local context
   *  to restore branch-level workspace tab and terminal selection. */
  navigationHistoryByRepo: Record<string, WorkspaceNavigationHistoryRepoState>
}

interface LocalWorkspaceActions {
  /** Records that `childIdentity` was opened from `openerIdentity` within a
   *  workspace-pane target scope. */
  setTabOpener: (scopeKey: string, childIdentity: string, openerIdentity: string) => void
  /** Clears a tab's recorded opener within a scope, e.g. once the tab has closed. */
  clearTabOpener: (scopeKey: string, childIdentity: string) => void
  recordWorkspaceNavigation: (
    entry: WorkspaceNavigationHistoryEntry,
    options?: { replace?: boolean; browserHistoryTraversal?: 'back' | 'forward' },
  ) => void
  peekWorkspaceNavigation: (repoId: string, direction: 'back' | 'forward') => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
}

interface RestorableWorkspaceActions {
  applySessionLayoutState: (layout: Pick<ClientWorkspaceState, 'zenMode' | 'workspacePaneSize'>) => void
  applySessionSelectedTerminalState: (selectedTerminalSessionIdByTerminalWorktree: Record<string, string>) => void
  setZenMode: (enabled: boolean) => void
  toggleZenMode: () => void
  setWorkspacePaneSize: (size: number) => void
  resetLayout: () => void
  setSelectedTerminal: (terminalWorktreeKey: string, terminalSessionId: string | null) => void
}

interface RuntimeCoherentRepoProjectionActions {
  /** Ensure a repo belongs to the open workspace set without implying
   *  anything about the current active selection. */
  ensureWorkspaceOpen: (path: string | RepoSessionEntry) => Promise<OpenRepoResult>
  closeRepo: (id: string) => Promise<CloseRepoResult>
  /**
   * Re-probe a remote repo's lifecycle. The single user-facing
   * entry point for "retry" (and the only path the
   * `useNetworkReconnect` hook calls to recover from a failed
   * lifecycle). Safe to call regardless of the current lifecycle
   * phase — the server starts a newer monotonic attempt.
   * Returns the new outcome, or `null` for non-remote ids.
   */
  retryRemoteRepoConnection: (id: string) => Promise<{ ok: boolean; reason?: string } | null>
  /** Updates the selected target's workspace pane tab type. The store does not project
   *  against terminal session count, worktree presence, or opened workspace pane tabs;
   *  the UI resolves the active pane at read time so session restore preserves
   *  target-scoped user intent. */
  setWorkspacePaneTab: (id: string, branch: string, tab: WorkspacePaneTabType | null) => void
  setWorkspacePaneTabForTarget: (target: WorkspacePaneTabsTarget, tab: WorkspacePaneTabType | null) => void
  setBranchViewMode: (id: string, viewMode: BranchViewMode) => void
  setLastResult: (id: string, result: ExecResult, repoRuntimeId: string, options?: RepoResultEventOptions) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateRestoredWorkspaceRuntime: (
    runtime: WorkspaceRuntimeRestoreSnapshot,
    options?: RepoWorkspaceHydrationOptions,
  ) => Promise<void>
  promoteRestoredWorkspaceRepo: (result: RepoWorkspaceTabsRestoreResult) => boolean
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, repoRuntimeId: string) => void
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
    LocalWorkspaceActions,
    RuntimeCoherentRepoProjectionActions,
    RepoMutationActions {}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
