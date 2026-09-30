// HTTP API response types shared by the server and browser client.
// Domain types live in their own modules.
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type {
  BranchSnapshotInfo,
  ExecResult,
  LogEntry,
  PullRequestInfo,
  RepoRemoteInfo,
  WorkspaceRepoWorktreeSnapshot,
  WorktreeStatus,
} from '#/shared/git-types.ts'
import type { WorkspacePaneSessionTabType, WorkspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type {
  EditorAppAvailability,
  Lang,
  LangPref,
  ResolvedTheme,
  UserSettings,
  TerminalAppAvailability,
  ThemePref,
} from '#/shared/settings.ts'
import type { WorkspaceSessionEntry, RemoteWorkspaceRuntimeLifecycle } from '#/shared/remote-workspace.ts'
import type { WorkspaceSettingsEntry } from '#/shared/workspace-settings.ts'
import type {
  WorkspaceCapabilities,
  WorkspaceGitReadyProbeState,
  WorkspaceProbeState,
} from '#/shared/workspace-runtime.ts'

export interface LanInfo {
  host: string
  port: number
  lanUrls: string[]
}

export type NetworkOpKind = 'user' | 'background'

export interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
  colorTheme: ColorTheme
}

export interface ServerWorkspaceState {
  /** User-level workspace membership, in picker order. */
  openWorkspaceEntries: WorkspaceSessionEntry[]
  /** Per-workspace, per-target pane layout that survives a server restart. */
  workspacePaneTabsByTargetByWorkspace: Record<string, Record<string, WorkspacePaneStaticTabEntry[]>>
}

export type BranchViewMode = 'all' | 'worktrees'

export interface ClientWorkspaceState {
  /** Workspace restored when opening `/`; null when none were open. */
  restoredWorkspaceId: WorkspaceId | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>
  /** Per-workspace branch navigator view mode. This is client UI preference, not Git runtime state. */
  branchViewModeByWorkspace: Record<string, BranchViewMode>
  /** Per-workspace, per-target pane tab preference that session restore can make renderable. */
  preferredWorkspacePaneTabByTargetByWorkspace: Record<string, Record<string, WorkspacePaneSessionTabType | null>>
  /** Per-workspace, per-filesystem-target file tree view state. */
  filetreeViewStateByFilesystemTargetByWorkspace: Record<string, Record<string, FiletreeSessionViewState>>
}

export interface FiletreeSessionViewState {
  selectedKeys: string[]
  expandedKeys: string[]
  topVisibleRowIndex: number
}

export interface RuntimeSettingsSnapshot extends UserSettings {}

export type RepoLogResponse = LogEntry[] | { ok: false; message: string }

export interface RuntimeRecentWorkspacesState {
  recentWorkspaces: WorkspaceSessionEntry[]
}

export interface WorkspaceRuntimeEntry {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  remoteLifecycle?: RemoteWorkspaceRuntimeLifecycle | null
  workspaceProbe: WorkspaceProbeState
}

export interface WorkspaceRuntimesSnapshot {
  runtimes: WorkspaceRuntimeEntry[]
}

export interface WorkspaceRuntimeMembershipReconcileResult {
  runtimes: WorkspaceRuntimeEntry[]
}

interface RestoredWorkspaceRuntimeBase {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  workspaceProbe: WorkspaceProbeState
}

interface RestoredWorkspaceTransport {
  entry: WorkspaceSessionEntry
  transport:
    | { kind: 'file' }
    | {
        kind: 'ssh'
        lifecycle: Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'ready' | 'failed' }>
      }
}

export type SnapshotRestoredWorkspaceRuntime = Omit<RestoredWorkspaceRuntimeBase, 'workspaceProbe'> &
  RestoredWorkspaceTransport & {
    workspaceProbe: WorkspaceGitReadyProbeState
    repoSnapshot: RepoSnapshot
  }

export type RestoredWorkspaceRuntimeWithoutSnapshot = RestoredWorkspaceRuntimeBase &
  RestoredWorkspaceTransport & {
    // Git may be conclusively unavailable or its projection may be deferred.
    // Workspace session projection state is derived separately from the probe.
    repoSnapshot: null
  }

export type RestoredWorkspaceRuntime = SnapshotRestoredWorkspaceRuntime | RestoredWorkspaceRuntimeWithoutSnapshot

export interface WorkspaceRuntimeRestoreSnapshot {
  workspaces: RestoredWorkspaceRuntime[]
  workspacePaneTabs: Array<{
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    snapshot: WorkspacePaneTabsSnapshot
  }>
  restoredWorkspaceId: WorkspaceId | null
}

export interface WorkspaceRestoreResult {
  status: 'restored' | 'repaired'
  openWorkspaceEntries: WorkspaceSessionEntry[]
  runtime: WorkspaceRuntimeRestoreSnapshot
}

export interface WorkspaceTabsRestoreResult {
  workspace: RestoredWorkspaceRuntime
  snapshot: WorkspacePaneTabsSnapshot | null
}

export interface WorkspaceSettingsState {
  workspaceSettings: WorkspaceSettingsEntry[]
}

export interface SettingsSnapshot
  extends RuntimeSettingsSnapshot, RuntimeRecentWorkspacesState, WorkspaceSettingsState {}

export interface GitHubCliState {
  available: boolean
  version: string | null
  detectedAt: number
  hosts: Record<string, GitHubCliHostState>
}

export interface GitHubCliHostState {
  host: string
  authenticated: boolean
  activeLogin: string | null
  logins: string[]
  tokenSource: string | null
}

export interface TerminalAppState {
  available: boolean
  appAvailability: TerminalAppAvailability
  detectedAt: number
}

export interface EditorAppState {
  available: boolean
  appAvailability: EditorAppAvailability
  detectedAt: number
}

export interface ExternalAppsSnapshot {
  terminal: TerminalAppState
  editor: EditorAppState
}

export interface I18nSnapshot {
  lang: Lang
  pref: LangPref
  dict: Record<string, string>
}

export interface UserSettingsUpdateResponse {
  ok: true
  prefs: UserSettings
  i18n?: I18nSnapshot
}

export interface RepoSnapshot {
  branches: BranchSnapshotInfo[]
  worktrees: WorkspaceRepoWorktreeSnapshot[]
  current: string
  remote: RepoRemoteInfo
}

// Workspace-filesystem-scoped tree protocol — see docs/filetree.md.

export type WorkspaceFilesystemNodeStatus = 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored'

export interface WorkspaceFilesystemNode {
  /** Stable id: relative POSIX path inside the filesystem root. */
  readonly id: string
  /** Relative POSIX path inside the filesystem root (matches id; named for readability). */
  readonly path: string
  /** Final path segment, used as the display name. */
  readonly name: string
  readonly parentId: string | null
  readonly kind: 'directory' | 'file'
  readonly status: WorkspaceFilesystemNodeStatus
  /** Present for lazily-loaded directory rows when the server knows the directory has children. */
  readonly hasChildren?: boolean
}

export interface WorkspaceFilesystemTreeResult {
  readonly nodes: ReadonlyArray<WorkspaceFilesystemNode>
  /** True if the direct-children result was truncated by the node-count cap. */
  readonly truncated: boolean
}

export type WorkspaceFileViewer = 'bat' | 'batcat' | 'cat' | 'type'
export type WorkspaceFileViewerShell = 'posix' | 'cmd'

export interface WorkspaceFileViewerResult {
  readonly viewer: WorkspaceFileViewer
  readonly shell: WorkspaceFileViewerShell
  readonly executionRoot: string
}

export type WorkspaceRuntimeOpenResult =
  | {
      ok: true
      workspace: { id: WorkspaceId }
      workspaceRuntimeId: string
      capabilities: WorkspaceCapabilities
      diagnostics: Array<{ scope: 'git' | 'transport'; message: string }>
    }
  | { ok: false; input: string; reason: string }
export type WorkspaceRuntimeOpenResponse = { ok: true; workspaceRuntimeId: string } | WorkspaceRuntimeOpenResult

export interface CloneRepoResult extends ExecResult {
  path?: string
}

export interface PullRequestEntry {
  branch: string
  pullRequest: PullRequestInfo
}

export type RepoPullRequestScope = { kind: 'branch-detail'; branch: string } | { kind: 'repository-summary' }

export interface RepoSnapshotResponse {
  snapshot: RepoSnapshot
}

export interface RepoPullRequestsResponse {
  pullRequests: PullRequestEntry[] | null
}

export type RepoServerOperationPhase = 'queued' | 'running' | 'cancelling' | 'done' | 'failed'
export type RepoServerOperationKind =
  'fetch' | 'pull' | 'push' | 'create-worktree' | 'delete-branch' | 'remove-worktree'
export type RepoServerOperationSource = NetworkOpKind | 'system'
export type RepoOperationCancellationReason =
  'caller-abort' | 'request-watchdog-timeout' | 'git-timeout' | 'network-op-superseded'
export type RepoOperationFailureReason = RepoOperationCancellationReason

export interface RepoServerOperationTarget {
  branch?: string
  worktreePath?: string
}

export interface RepoServerOperationCancellationState {
  underlyingRequested: boolean
  reason: RepoOperationCancellationReason | null
  requestedAt: number | null
  waitCancelledCount: number
  lastWaitCancelledAt: number | null
  lastWaitCancellationReason: RepoOperationCancellationReason | null
}

export interface RepoServerOperationError {
  message: string
  reason: RepoOperationFailureReason | null
}

export interface RepoServerOperationState {
  id: string
  repoId: WorkspaceId | null
  workspaceRuntimeId: string | null
  kind: RepoServerOperationKind
  phase: RepoServerOperationPhase
  source: RepoServerOperationSource
  target: RepoServerOperationTarget | null
  queuedAt: number
  startedAt: number | null
  deadlineAt: number | null
  settledAt: number | null
  error: RepoServerOperationError | null
  cancellation: RepoServerOperationCancellationState
  canCancelUnderlying: boolean
}

export interface RepoOperationsSnapshot {
  operations: RepoServerOperationState[]
  lastFetchAt: number | null
  loadedAt: number
}

export interface RepoWorktreeStatusSnapshot {
  workspaceRuntimeId: string
  status: WorktreeStatus[]
  loadedAt: number
}
