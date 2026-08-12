// HTTP API response types and native bridge IPC types shared by
// main, server, and client. Domain types live in their own
// modules (#/shared/git-types.ts, #/shared/settings.ts, etc.);
// this file aggregates what crosses process/transport boundaries.

import * as v from 'valibot'
import { CodedError } from '#/shared/coded-error.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type {
  BranchSnapshotInfo,
  ExecResult,
  LogEntry,
  PullRequestInfo,
  RepoRemoteInfo,
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

export type NativeClientWorkspaceReadResult = { kind: 'loaded'; state: unknown }

export interface FiletreeSessionViewState {
  selectedKeys: string[]
  expandedKeys: string[]
  topVisibleRowIndex: number
}

export interface RuntimeSettingsSnapshot extends UserSettings {
  globalShortcutRegistered: boolean
}

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

export type SetGlobalShortcutResult =
  { kind: 'projected'; accelerator: string; registered: boolean } | { kind: 'committed-projection-failed' }

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
  current: string
  /** Short commit hash when HEAD is detached (no branch checked out). */
  currentHEAD?: string
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

/** Request envelope for the native Electron bridge IPC layer. */
export interface IpcRequest {
  path: string
  input?: unknown
  requestId?: string
}

/** Response envelope for the native Electron bridge IPC layer. */
export interface IpcResponseError {
  message: string
  code?: string
  name?: string
}

export type IpcResponse = { ok: true; data: unknown } | { ok: false; error: IpcResponseError }

export interface NativeHostSettingsIpcHandlers {
  settings: {
    setGlobalShortcut: (input: { accelerator: string }) => Promise<SetGlobalShortcutResult>
  }
}

export interface NativeHostIpcHandlers extends NativeHostSettingsIpcHandlers {
  clientWorkspace: {
    read: (_input: undefined) => Promise<NativeClientWorkspaceReadResult>
    write: (input: ClientWorkspaceState) => Promise<void>
  }
}

export type NativeHostIpcPath = {
  [NS in keyof NativeHostIpcHandlers]: `${Extract<NS, string>}.${Extract<keyof NativeHostIpcHandlers[NS], string>}`
}[keyof NativeHostIpcHandlers]

type IpcInputSchema<TInput> = v.BaseSchema<unknown, TInput, v.BaseIssue<unknown>>

function parseIpcInput<TInput>(schema: IpcInputSchema<TInput>, input: unknown): TInput {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new CodedError({ code: 'BAD_REQUEST', message: 'Invalid IPC input' })
  return parsed.output
}

function createValidatedProcedure<TInput, TOutput>(
  schema: IpcInputSchema<TInput>,
  handler: (input: TInput) => Promise<TOutput> | TOutput,
): (input: unknown) => Promise<TOutput> {
  return async (input: unknown) => await handler(parseIpcInput<TInput>(schema, input))
}

// These projections are intentionally derived from the handler authority: a
// new native procedure must add a schema and a caller implementation before
// createAppRouter can satisfy AppRouter.
type AppRouterCaller = {
  [Namespace in keyof NativeHostIpcHandlers]: {
    [Procedure in keyof NativeHostIpcHandlers[Namespace]]: NativeHostIpcHandlers[Namespace][Procedure] extends (
      ...args: never[]
    ) => infer TOutput
      ? (input: unknown) => Promise<Awaited<TOutput>>
      : never
  }
}

export interface AppRouter {
  createCaller: () => AppRouterCaller
}

type NativeHostIpcProcedureSchemas = {
  [Namespace in keyof NativeHostIpcHandlers]: {
    [Procedure in keyof NativeHostIpcHandlers[Namespace]]: NativeHostIpcHandlers[Namespace][Procedure] extends (
      input: infer TInput,
    ) => unknown
      ? IpcInputSchema<TInput>
      : never
  }
}

export function createAppRouter(handlers: NativeHostIpcHandlers, schemas: NativeHostIpcProcedureSchemas): AppRouter {
  return {
    createCaller: () => ({
      clientWorkspace: {
        read: createValidatedProcedure(schemas.clientWorkspace.read, handlers.clientWorkspace.read),
        write: createValidatedProcedure(schemas.clientWorkspace.write, handlers.clientWorkspace.write),
      },
      settings: {
        setGlobalShortcut: createValidatedProcedure(
          schemas.settings.setGlobalShortcut,
          handlers.settings.setGlobalShortcut,
        ),
      },
    }),
  }
}
