import type { StoreApi } from 'zustand'
import type { BranchSnapshotInfo, BrowserRemoteProvider, ExecResult, GitRemoteInfo } from '#/web/types.ts'
import type { RemoteWorkspaceConnectionLifecycle, WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type {
  ClientWorkspaceState,
  WorkspaceTabsRestoreResult,
  WorkspaceRuntimeRestoreSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/workspaces/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/workspaces/operations.ts'
import type { RepoDataLoadBundle } from '#/web/stores/workspaces/repo-data-load-state.ts'
import type {
  WorkspaceFilesystemReadyProbeState,
  WorkspaceGitReadyProbeState,
  WorkspaceProbeState,
} from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
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

/** Discriminated union: a successful open guarantees `workspaceId`; a failed
 *  open carries a translation key or raw message. The shape forces
 *  callers to narrow before reading either field. */
export interface OpenWorkspacePostOpenError {
  kind: 'recent-workspace'
  message: string
}

export type OpenWorkspaceResult =
  | { ok: true; workspaceId: WorkspaceId; postOpenEffects?: Promise<OpenWorkspacePostOpenError[]> }
  | { ok: false; message: string }

export type CloseWorkspaceResult = { ok: true } | { ok: false; message: string }

export interface RepoWorktreeState {
  path: string
  branch?: string
  isMain: boolean
  isDirty?: boolean
  changeCount?: number
  isLocked?: boolean
}

export interface WorkspaceUiState {
  /** Target-scoped selected workspace pane tab. Worktree-backed panes are keyed by
   *  worktree path; branch-only panes are keyed by branch name. `null` is an
   *  intentional empty workspace pane, not a missing preference. */
  preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType | null>
}

interface RepoProjectionMeta {
  source: RepoDataSource
  savedAt: number | null
}

export interface GitRemoteProjection {
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

/** Filesystem-transport admission state, independent from optional Git capability. */
export type WorkspaceAdmissionState =
  | { kind: 'local' }
  | { kind: 'remote'; lifecycle: RemoteWorkspaceConnectionLifecycle | null; lifecycleAttemptId: number | null }

/** Git-only client state, owned exclusively by the Git capability. */
export interface GitWorkspaceProjection {
  dataLoads: RepoDataLoadBundle
  lastFetchAt: number | null
  operations: RepoOperationsState
  ui: { branchViewMode: BranchViewMode }
  projection: RepoProjectionMeta
  remote: GitRemoteProjection
  events: RepoEvent[]
}

export type WorkspaceCapabilityState =
  | { kind: 'probing'; probe: Extract<WorkspaceProbeState, { status: 'probing' }> }
  | { kind: 'unavailable'; probe: Extract<WorkspaceProbeState, { status: 'unavailable' }> }
  | { kind: 'filesystem'; probe: WorkspaceFilesystemReadyProbeState }
  | {
      kind: 'git'
      probe: WorkspaceGitReadyProbeState
      git: GitWorkspaceProjection
    }

export type WorkspaceSessionProjectionState = 'projected' | 'stub'

export interface WorkspaceSessionState {
  /** Canonical session entry for the workspace shell. Remote stubs only know a
   *  ref, not a resolved target, so the entry must be preserved directly. */
  entry: WorkspaceSessionEntry | null
  /** Whether target-scoped session state is client-owned yet. Stub workspaces keep
   *  the server baseline until the workspace is projected on view. */
  projectionState: WorkspaceSessionProjectionState
}

export interface RepoSnapshotCacheEntry {
  savedAt: number
  name: string
  data: {
    branches: RepoBranchState[]
    currentBranch: string
  }
  ui: { branchViewMode: BranchViewMode }
}

export interface WorkspaceState {
  /** Canonical workspace id. Local workspace ids encode their absolute filesystem root. */
  id: WorkspaceId
  name: string
  /** Current runtime authority for this workspace; mirrors the runtime endpoint `workspaceRuntimeId`. */
  workspaceRuntimeId: string
  ui: WorkspaceUiState
  session: WorkspaceSessionState
  admission: WorkspaceAdmissionState
  capability: WorkspaceCapabilityState
}

export interface RuntimeCoherentWorkspaceState {
  /** Client-local projection of runtime-coherent workspace state. */
  workspaces: Record<string, WorkspaceState>
}

interface RepoSnapshotCacheState {
  /** Warm-start cache used only for restore. This is not runtime-coherent shared state. */
  repoSnapshotCache: Record<string, RepoSnapshotCacheEntry>
}

export interface RestorableWorkspaceState {
  /** Client workspace UI state that is serialized into ClientWorkspaceState for
   *  next-launch restore. This is restorable state, not runtime-coherent
   *  shared state. */
  /** Open workspace order restored from the server workspace. */
  workspaceOrder: WorkspaceId[]
  /**
   * Session workspace restored from ClientWorkspaceState.restoredWorkspaceId.
   * The route owns the current workspace.
   */
  restoredWorkspaceId: WorkspaceId | null
  /** Large-screen Zen Mode restored from ClientWorkspaceState. Compact UI is stronger and always shows one pane at a time. */
  zenMode: boolean
  workspacePaneSize: number
  /** Per-filesystem-target terminal selection restored from ClientWorkspaceState. */
  selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>
}

export type WorkspaceNavigationHistoryRoute =
  | { kind: 'empty' }
  | { kind: 'workspace-root'; workspacePaneTab: WorkspacePaneTabType | null; terminalSessionId: string | null }
  | { kind: 'dashboard' }
  | { kind: 'newWorktree'; returnTo: string | null }
  | {
      kind: 'worktree'
      worktreePath: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalSessionId: string | null
    }
  | {
      kind: 'branch'
      branchName: string
      workspacePaneTab: WorkspacePaneTabType | null
      terminalFilesystemTargetKey: string | null
      terminalSessionId: string | null
    }

export interface WorkspaceNavigationHistoryEntry {
  workspaceId: WorkspaceId
  route: WorkspaceNavigationHistoryRoute
}

export interface WorkspaceNavigationHistoryState {
  current: WorkspaceNavigationHistoryEntry | null
  backStack: WorkspaceNavigationHistoryEntry[]
  forwardStack: WorkspaceNavigationHistoryEntry[]
}

export interface WorkspaceNavigationHistoryTraversal {
  workspaceId: WorkspaceId
  direction: 'back' | 'forward'
  current: WorkspaceNavigationHistoryEntry
  target: WorkspaceNavigationHistoryEntry
}

export interface WorkspaceHydrationOptions {
  signal?: AbortSignal
  restoredClientWorkspace?: ClientWorkspaceState
}

interface LocalWorkspaceState {
  /** Client-only workspace UI state that should never be serialized into
   *  ClientWorkspaceState or treated as restorable workspace state. */
  /** Workspace membership restore flag. True once boot workspace entries have
   *  produced the placeholder workspace set (or proved there are no workspaces), so the
   *  workspace shell can render without overwriting the saved workspace with an
   *  empty one before restore. Workspace content hydration may still be running. */
  workspaceMembershipReady: boolean
  /** Persistence gate — true only after all boot-restored state that can
   *  affect ClientWorkspaceState has converged back into the client store. */
  sessionPersistenceReady: boolean
  /** Boot restore failure that blocks session persistence. UI can render, but
   *  persisted workspace state must not be overwritten until the restore issue
   *  is resolved by a successful boot. */
  sessionRestoreError: string | null
  /** Client-owned state from boot restore, retained while workspaces remain stubs. */
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
  /** Session-only app navigation history, scoped by workspace. The route owns
   *  the visible workspace/branch, while this store keeps enough local context
   *  to restore branch-level workspace tab and terminal selection. */
  navigationHistoryByWorkspace: Record<string, WorkspaceNavigationHistoryState>
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
  peekWorkspaceNavigation: (
    workspaceId: WorkspaceId,
    direction: 'back' | 'forward',
  ) => WorkspaceNavigationHistoryTraversal | null
  commitWorkspaceNavigation: (traversal: WorkspaceNavigationHistoryTraversal) => boolean
}

interface RestorableWorkspaceActions {
  applySessionLayoutState: (layout: Pick<ClientWorkspaceState, 'zenMode' | 'workspacePaneSize'>) => void
  applySessionSelectedTerminalState: (
    selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>,
  ) => void
  setZenMode: (enabled: boolean) => void
  toggleZenMode: () => void
  setWorkspacePaneSize: (size: number) => void
  resetLayout: () => void
  setSelectedTerminal: (terminalFilesystemTargetKey: string, terminalSessionId: string | null) => void
}

interface WorkspaceLifecycleActions {
  /** Ensure a workspace belongs to the open workspace set without implying
   *  anything about the current active selection. */
  ensureWorkspaceOpen: (path: string | WorkspaceSessionEntry) => Promise<OpenWorkspaceResult>
  closeWorkspace: (workspaceId: WorkspaceId) => Promise<CloseWorkspaceResult>
  /**
   * Re-probe a remote workspace's lifecycle. The single user-facing
   * entry point for "retry" (and the only path the
   * `useNetworkReconnect` hook calls to recover from a failed
   * lifecycle). Safe to call regardless of the current lifecycle
   * phase — the server starts a newer monotonic attempt.
   * Returns the new outcome, or `null` for non-remote ids.
   */
  retryRemoteWorkspaceConnection: (id: WorkspaceId) => Promise<{ ok: boolean; reason?: string } | null>
  hydrateRestoredWorkspaceRuntime: (
    runtime: WorkspaceRuntimeRestoreSnapshot,
    options?: WorkspaceHydrationOptions,
  ) => Promise<void>
  promoteRestoredWorkspace: (result: WorkspaceTabsRestoreResult) => boolean
}

interface WorkspacePanePreferenceActions {
  /** Updates the selected target's workspace pane tab type. The store does not project
   *  against terminal session count, worktree presence, or opened workspace pane tabs;
   *  the UI resolves the active pane at read time so session restore preserves
   *  target-scoped user intent. */
  setWorkspacePaneTabForTarget: (target: WorkspacePaneTabsTarget, tab: WorkspacePaneTabType | null) => void
}

interface GitWorkspaceProjectionActions {
  setWorkspacePaneTab: (id: WorkspaceId, branch: string, tab: WorkspacePaneTabType | null) => void
  setBranchViewMode: (id: WorkspaceId, viewMode: BranchViewMode) => void
  setLastResult: (
    id: WorkspaceId,
    result: ExecResult,
    workspaceRuntimeId: string,
    options?: RepoResultEventOptions,
  ) => void
  clearEvents: (id: WorkspaceId, eventIds: number[]) => void
  /** Clear the fetchFailed flag after a successful Git fetch or explicit Git refresh. */
  clearFetchFailed: (id: WorkspaceId, workspaceRuntimeId: string) => void
}

interface GitWorkspaceMutationActions {
  runBranchAction: (
    id: WorkspaceId,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<ExecResult | null>
  /** Fire-and-forget submission for branch actions whose UI should close
   *  immediately and let Git activity/toasts carry completion. This only
   *  triggers submission; callers should not treat it as accepted/completed. */
  submitBranchAction: (id: WorkspaceId, action: RepoBranchAction, options?: RunBranchActionOptions) => void
}

export interface WorkspacesStore
  extends
    RuntimeCoherentWorkspaceState,
    RepoSnapshotCacheState,
    RestorableWorkspaceState,
    LocalWorkspaceState,
    RestorableWorkspaceActions,
    LocalWorkspaceActions,
    WorkspaceLifecycleActions,
    WorkspacePanePreferenceActions,
    GitWorkspaceProjectionActions,
    GitWorkspaceMutationActions {}

export type WorkspacesSet = StoreApi<WorkspacesStore>['setState']
export type WorkspacesGet = StoreApi<WorkspacesStore>['getState']
