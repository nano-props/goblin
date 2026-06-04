import type { StoreApi } from 'zustand'
import type {
  BranchSnapshotInfo,
  BrowserRemoteProvider,
  ExecResult,
  GitRemoteInfo,
  PullRequestFetchMode,
  WorktreeStatus,
} from '#/web/types.ts'
import type { RemoteRepoTarget, RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspaceDetailPaneSizes, WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { SessionState } from '#/shared/rpc.ts'
import type { RepoBranchAction, RunBranchActionOptions } from '#/web/stores/repos/branch-action-types.ts'
import type { RepoOperationsState } from '#/web/stores/repos/operations.ts'
import type { RepoResourcesState } from '#/web/stores/repos/resources.ts'
export type DetailTab = 'status' | 'terminal'
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
  detailTab: DetailTab
}

export interface RepoCacheState {
  source: RepoDataSource
  savedAt: number | null
}

export interface RepoRemoteState {
  target?: RemoteRepoTarget
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

export interface CachedRepoState {
  savedAt: number
  name: string
  data: Pick<RepoDataState, 'branches' | 'currentBranch' | 'status' | 'statusLoaded' | 'worktreesByPath'>
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
  operations: RepoOperationsState
  ui: RepoUiState
  cache: RepoCacheState
  remote: RepoRemoteState
  availability: RepoAvailabilityState
  events: RepoEvent[]
}

export interface PersistableWorkspaceUiState {
  /** Renderer workspace UI state that is serialized into SessionState for
   *  next-launch restore. This is a persistence boundary, not a live
   *  source-of-truth relationship with the settings/session store. */
  /** Workspace tab order restored from SessionState.openRepos. */
  order: string[]
  /** Active workspace tab restored from SessionState.activeRepo. */
  activeId: string | null
  detailCollapsed: boolean
  detailFocusMode: boolean
  workspaceLayout: RepoWorkspaceLayout
  detailPaneSizes: WorkspaceDetailPaneSizes
  /** Per worktree terminal selection restored from SessionState.selectedTerminalByWorktree. */
  selectedTerminalByWorktree: Record<string, string>
}

export interface WorkspaceFrontendUiState {
  /** Renderer-only workspace UI state that should never be serialized into
   *  SessionState or treated as boot-restorable workspace state. */
  /** Hydration flag — true once boot session is restored, so we don't
   *  overwrite the saved session with an empty one before restore. */
  sessionReady: boolean
  /** Ephemeral renderer-only branch filter text; never persisted to SessionState. */
  branchSearchQueries: Record<string, string>
}

export interface ReposStore extends PersistableWorkspaceUiState, WorkspaceFrontendUiState {
  repos: Record<string, RepoState>
  repoCache: Record<string, CachedRepoState>

  /** Ensure a repo belongs to the open workspace set without implying
   *  anything about the current active selection. */
  ensureWorkspaceOpen: (path: string | RepoSessionEntry) => Promise<OpenRepoResult>
  closeRepo: (id: string) => void
  setActive: (id: string) => void
  /** Reorder the tab strip so `fromId` lands at `toId`'s position, using
   *  the same shift semantics as dnd-kit's `arrayMove` (the rest of the
   *  list closes the gap; later items shift up if `from < to`, down if
   *  `from > to`). No-op if either id is unknown or they're identical. */
  reorderRepos: (fromId: string, toId: string) => void
  setDetailTab: (id: string, tab: DetailTab) => void
  dismissExitedTerminalDetail: (
    id: string,
    worktreePath: string,
    options?: { affectVisibleWorkspace?: boolean },
  ) => void
  setDetailCollapsed: (collapsed: boolean) => void
  toggleDetailCollapsed: () => void
  setDetailFocusMode: (focused: boolean) => void
  toggleDetailFocusMode: () => void
  setWorkspaceLayout: (layout: RepoWorkspaceLayout) => void
  applySessionLayoutState: (
    layout: Pick<SessionState, 'workspaceLayout' | 'detailCollapsed' | 'detailFocusMode' | 'detailPaneSizes'>,
  ) => void
  applySessionSelectedTerminalState: (selectedTerminalByWorktree: Record<string, string>) => void
  setDetailPaneSize: (layout: RepoWorkspaceLayout, size: number) => void
  setDetailPaneSizes: (sizes: WorkspaceDetailPaneSizes) => void
  resetLayout: () => void
  setSelectedTerminal: (worktreeTerminalKey: string, key: string | null) => void
  setBranchViewMode: (id: string, viewMode: BranchViewMode) => void
  setBranchSearchQuery: (id: string, query: string) => void
  selectBranch: (id: string, branch: string) => void
  cycleActive: (direction: 1 | -1) => void
  checkoutSelectedInRepo: (id: string) => Promise<void>
  /** Keyboard-driven checkout of the active repo's selected branch.
   *  Centralizes the eligibility checks the keyboard hook used to do. */
  checkoutSelected: () => Promise<void>
  refreshSnapshot: (id: string, options?: { skipLogBackfill?: boolean; token?: number }) => Promise<void>
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
  runBranchAction: (
    id: string,
    action: RepoBranchAction,
    options?: RunBranchActionOptions,
  ) => Promise<ExecResult | null>
  /** Fire-and-forget submission for branch actions whose UI should close
   *  immediately and let repo activity/toasts carry completion. This only
   *  triggers submission; callers should not treat it as accepted/completed. */
  submitBranchAction: (id: string, action: RepoBranchAction, options?: RunBranchActionOptions) => void

  setLastResult: (
    id: string,
    result: { ok: boolean; message: string },
    token: number,
    options?: RepoResultEventOptions,
  ) => void
  clearEvents: (id: string, eventIds: number[]) => void
  hydrateSession: (openRepos: RepoSessionEntry[], activeRepo: string | null) => Promise<void>
  /** Clear the fetchFailed flag — called by manual fetch success and
   *  by an explicit refresh, so a stale badge doesn't follow the user
   *  around forever. */
  clearFetchFailed: (id: string, token: number) => void
}

export type ReposSet = StoreApi<ReposStore>['setState']
export type ReposGet = StoreApi<ReposStore>['getState']
