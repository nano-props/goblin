// HTTP API response types and native bridge IPC types shared by
// main, server, and client. Domain types live in their own
// modules (#/shared/git-types.ts, #/shared/settings.ts, etc.);
// this file aggregates what crosses process/transport boundaries.

import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import type {
  BranchSnapshotInfo,
  ExecResult,
  LogEntry,
  PullRequestFetchMode,
  PullRequestInfo,
  RepoRemoteInfo,
  RepoUrlTarget,
  WorktreeStatus,
} from '#/shared/git-types.ts'
import type { WorkspacePaneSessionTabType, WorkspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type {
  EditorAppAvailability,
  EditorApp,
  Lang,
  LangPref,
  ResolvedTheme,
  UserSettings,
  TerminalAppAvailability,
  TerminalApp,
  ThemePref,
} from '#/shared/settings.ts'
import type {
  RemoteConnectionInput,
  RemoteDiagnosticsResult,
  WorkspaceSessionEntry,
  RemoteWorkspaceTarget,
  RemoteWorkspaceRuntimeLifecycle,
  ResolvedRemoteWorkspaceTarget,
  SshConfigHostsResult,
} from '#/shared/remote-workspace.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { RemoteAbsolutePathSchema } from '#/shared/remote-workspace-schema.ts'
import type { CreateWorktreeIpcInput, RemoteTrackingBranchIdentity } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceSettingsEntry } from '#/shared/workspace-settings.ts'
import type {
  WorkspaceCapabilities,
  WorkspaceGitReadyProbeState,
  WorkspacePaneFilesystemExecutionTarget,
  WorkspaceProbeState,
} from '#/shared/workspace-runtime.ts'
import { DirectoryPathPrefixSchema } from '#/shared/directory-path-suggestions.ts'
import type { RemoteDirectoryPathSuggestionsInput } from '#/shared/directory-path-suggestions.ts'

export type { SettingsPage } from '#/shared/settings-pages.ts'
export type {
  EditorApp,
  EditorAppAvailability,
  Lang,
  LangPref,
  ResolvedTheme,
  UserSettings,
  TerminalApp,
  TerminalAppAvailability,
  ThemePref,
} from '#/shared/settings.ts'
export type {
  NativeRecentWorkspacesProjection,
  NativeSettingsProjectionPatch,
  NativeSettingsProjectionState,
  NativeHostProjection,
} from '#/shared/native-host-projection.ts'
export type {
  WorkspaceSettingsEntry,
  WorktreeBootstrapTrust,
  WorkspaceExternalAppRecent,
} from '#/shared/workspace-settings.ts'

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

export interface ClientWorkspaceState {
  /** Workspace restored when opening `/`; null when none were open. */
  restoredWorkspaceId: WorkspaceId | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalFilesystemTarget: Record<string, string>
  /** Per-workspace, per-target pane tab preference that session restore can make renderable. */
  preferredWorkspacePaneTabByTargetByWorkspace: Record<string, Record<string, WorkspacePaneSessionTabType | null>>
  /** Per-workspace, per-filesystem-target file tree view state. */
  filetreeViewStateByFilesystemTargetByWorkspace: Record<string, Record<string, FiletreeSessionViewState>>
}

export type NativeClientWorkspaceReadResult = { kind: 'missing' } | { kind: 'loaded'; state: unknown }

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
  name: string
  workspaceProbe: WorkspaceProbeState
}

type RestoredWorkspaceTransport = {
  entry: WorkspaceSessionEntry
} & (
  | { transport: { kind: 'file' } }
  | {
      transport: {
        kind: 'ssh'
        lifecycle: Extract<RemoteWorkspaceRuntimeLifecycle, { kind: 'ready' | 'failed' }>
      }
    }
)

export type GitProjectedRestoredWorkspaceRuntime = Omit<RestoredWorkspaceRuntimeBase, 'workspaceProbe'> &
  RestoredWorkspaceTransport & {
    workspaceProbe: WorkspaceGitReadyProbeState
    gitProjection: GitWorkspaceRuntimeProjection
  }

export type RestoredWorkspaceRuntimeWithoutGitProjection = RestoredWorkspaceRuntimeBase &
  RestoredWorkspaceTransport & {
    // Git may be conclusively unavailable or its projection may be deferred.
    // Workspace session projection state is derived separately from the probe.
    gitProjection: null
  }

export type RestoredWorkspaceRuntime =
  GitProjectedRestoredWorkspaceRuntime | RestoredWorkspaceRuntimeWithoutGitProjection

export function hasRestoredWorkspaceGitProjection(
  workspace: RestoredWorkspaceRuntime,
): workspace is GitProjectedRestoredWorkspaceRuntime {
  return workspace.gitProjection !== null
}

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

export interface GlobalShortcutState {
  accelerator: string
  registered: boolean
}

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
  remote?: RepoRemoteInfo
}

// Workspace-filesystem-scoped tree types — see docs/filetree.md. Wire and
// domain shapes coincide in v1; if they diverge, move these into a
// dedicated `src/shared/filetree.ts` and map at the hook boundary.

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
      workspace: { id: WorkspaceId; name: string }
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

export type RepoServerOperationPhase = 'queued' | 'running' | 'cancelling' | 'done' | 'failed'
export type RepoServerOperationKind =
  'fetch' | 'clone' | 'pull' | 'push' | 'create-worktree' | 'delete-branch' | 'remove-worktree' | 'network'
export type RepoServerOperationSource = NetworkOpKind | 'system'
export type RepoOperationCancellationReason =
  'caller-abort' | 'request-watchdog-timeout' | 'git-timeout' | 'network-op-superseded'
export type RepoOperationFailureReason = RepoOperationCancellationReason

export interface RepoServerOperationTarget {
  branch?: string
  worktreePath?: string
  parentPath?: string
  directoryName?: string
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

export interface GitWorkspaceRuntimeProjection {
  snapshot: RepoSnapshot | null
  pullRequests: PullRequestEntry[] | null
  requested: {
    branch: string | null
    pullRequestMode: PullRequestFetchMode
  }
  loadedAt: number
}

export interface RepoWorktreeStatusSnapshot {
  workspaceRuntimeId: string
  status: WorktreeStatus[]
  loadedAt: number
}

export type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
export { isRemoteWorkspaceId, parseRemoteWorkspaceId } from '#/shared/remote-workspace.ts'

/** Request envelope for the native Electron bridge IPC layer. */
export interface IpcRequest {
  path: string
  input?: unknown
  requestId?: string
}

/** Response envelope for the native Electron bridge IPC layer. */
export type IpcResponse =
  { ok: true; data: unknown } | { ok: false; error: { message: string; code?: string; name?: string } }

export type I18nChangedEvent = { type: 'i18n-changed'; snapshot: I18nSnapshot }

/** Events pushed from the native Electron bridge to the client. */
export type IpcEvent =
  | { type: 'fetch-interval-changed'; sec: number }
  | { type: 'terminal-notifications-changed'; enabled: boolean }
  | { type: 'shortcuts-disabled-changed'; disabled: boolean }
  | { type: 'global-shortcut-disabled-changed'; disabled: boolean }
  | { type: 'github-cli-changed'; state: GitHubCliState }
  | { type: 'settings-write-error'; message: string }
  | I18nChangedEvent
  | RepoQueryInvalidationEvent

export interface AppIpcHandlers {
  workspace: {
    runtimeOpen: (
      input: ({ workspaceId: WorkspaceId } | { workspaceInput: string }) & { clientId: string },
    ) => Promise<WorkspaceRuntimeOpenResponse>
    runtimeReconcile: (input: {
      clientId: string
      workspaceIds: WorkspaceId[]
    }) => Promise<WorkspaceRuntimeMembershipReconcileResult>
    runtimeList: () => Promise<WorkspaceRuntimesSnapshot>
    runtimeClose: (input: { workspaceId: WorkspaceId; workspaceRuntimeId: string; clientId: string }) => Promise<{
      ok: boolean
      released: boolean
      runtimeClosed: boolean
    }>
    tree: (input: {
      target: WorkspacePaneFilesystemExecutionTarget
      prefix?: string
    }) => Promise<WorkspaceFilesystemTreeResult>
    trashFile: (input: { target: WorkspacePaneFilesystemExecutionTarget; path: string }) => Promise<ExecResult>
    fileViewer: (input: { target: WorkspacePaneFilesystemExecutionTarget }) => Promise<WorkspaceFileViewerResult>
    openTerminal: (input: { target: WorkspacePaneFilesystemExecutionTarget; app: TerminalApp }) => Promise<ExecResult>
    openEditor: (input: { target: WorkspacePaneFilesystemExecutionTarget; app: EditorApp }) => Promise<ExecResult>
    openInFinder: (input: { target: WorkspacePaneFilesystemExecutionTarget }) => Promise<ExecResult>
  }
  repo: {
    clone: (input: { url: string; parentPath: string; directoryName: string }) => Promise<CloneRepoResult>
    projection: (input: {
      cwd: WorkspaceId
      workspaceRuntimeId: string
      branch?: string
      mode?: PullRequestFetchMode
    }) => Promise<GitWorkspaceRuntimeProjection>
    operations: (
      input: { includeSettled?: boolean } | { cwd: WorkspaceId; workspaceRuntimeId: string; includeSettled?: boolean },
    ) => Promise<RepoOperationsSnapshot>
    patch: (input: { cwd: WorkspaceId; workspaceRuntimeId: string; worktreePath: string }) => Promise<ExecResult>
    deleteBranch: (input: {
      cwd: WorkspaceId
      workspaceRuntimeId: string
      branch: string
      force?: boolean
      deleteUpstream?: boolean
    }) => Promise<ExecResult>
    removeWorktree: (input: {
      cwd: WorkspaceId
      workspaceRuntimeId: string
      branch: string
      worktreePath: string
      deleteBranch: boolean
      forceDeleteBranch?: boolean
      deleteUpstream?: boolean
    }) => Promise<ExecResult>
    createWorktree: (input: CreateWorktreeIpcInput) => Promise<ExecResult>
    worktreeBootstrapPreview: (input: {
      cwd: WorkspaceId
      workspaceRuntimeId: string
    }) => Promise<WorktreeBootstrapPreviewResult>
    remoteBranches: (input: { cwd: WorkspaceId; workspaceRuntimeId: string }) => Promise<RemoteTrackingBranchIdentity[]>
    pull: (input: {
      cwd: WorkspaceId
      workspaceRuntimeId: string
      branch: string
      worktreePath?: string
    }) => Promise<ExecResult>
    push: (input: { cwd: WorkspaceId; workspaceRuntimeId: string; branch: string }) => Promise<ExecResult>
    fetch: (input: { cwd: WorkspaceId; workspaceRuntimeId: string }) => Promise<ExecResult>
    openUrl: (input: { cwd: WorkspaceId; workspaceRuntimeId: string; target: RepoUrlTarget }) => Promise<ExecResult>
    backgroundSyncRepos: (input: {
      clientId: string
      revision: number
      targets: GitBackgroundSyncTarget[]
    }) => Promise<{
      ok: true
      repoIds: WorkspaceId[]
      intervalSec: number
    }>
  }
  remote: {
    listSshHosts: () => Promise<SshConfigHostsResult>
    resolveTarget: (input: RemoteConnectionInput) => Promise<ResolvedRemoteWorkspaceTarget>
    listPathSuggestions: (input: RemoteDirectoryPathSuggestionsInput) => Promise<string[]>
    testWorkspace: (input: { target: RemoteWorkspaceTarget }) => Promise<RemoteDiagnosticsResult>
  }
  theme: {
    get: () => ThemeState
    setPref: (input: { pref: ThemePref }) => Promise<ThemeState>
    setColorTheme: (input: { colorTheme: ColorTheme }) => Promise<ThemeState>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    setFetchInterval: (input: { sec: number }) => Promise<void>
    setTerminalNotificationsEnabled: (input: { enabled: boolean }) => Promise<void>
    setShortcutsDisabled: (input: { disabled: boolean }) => Promise<void>
    setGlobalShortcutDisabled: (input: { disabled: boolean }) => Promise<void>
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
    addRecentWorkspace: (input: { workspace: WorkspaceSessionEntry }) => Promise<WorkspaceSessionEntry[]>
    clearRecentWorkspaces: () => Promise<void>
  }
  externalApps: {
    get: () => Promise<ExternalAppsSnapshot>
    refresh: () => Promise<ExternalAppsSnapshot>
  }
  githubCli: {
    get: (input: { hosts?: string[] } | undefined) => Promise<GitHubCliState>
    refresh: (input: { hosts?: string[] } | undefined) => Promise<GitHubCliState>
  }
  i18n: {
    get: () => Promise<I18nSnapshot>
    setPref: (input: { pref: LangPref }) => Promise<I18nSnapshot | null>
  }
}

export interface NativeHostIpcHandlers {
  clientWorkspace: {
    read: (_input: undefined) => Promise<NativeClientWorkspaceReadResult>
    write: (input: ClientWorkspaceState) => Promise<void>
  }
  settings: {
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
  }
}

export type NativeHostIpcPath = {
  [NS in keyof NativeHostIpcHandlers]: `${Extract<NS, string>}.${Extract<keyof NativeHostIpcHandlers[NS], string>}`
}[keyof NativeHostIpcHandlers]

const FiniteNumber = v.pipe(v.number(), v.finite())
const PortNumber = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))

/** Canonical WorkspaceId envelope shared by Git procedures. */
export const CwdInput = v.object({ cwd: WorkspaceIdSchema })

export const RemoteWorkspaceTargetSchema = v.object({
  id: WorkspaceIdSchema,
  alias: v.string(),
  host: v.string(),
  user: v.string(),
  port: PortNumber,
  remotePath: RemoteAbsolutePathSchema,
  displayName: v.string(),
})

export const RemoteConnectionInputSchema = v.object({
  alias: v.string(),
  remotePath: v.string(),
})

export const RemoteDirectoryPathSuggestionsInputSchema = v.object({
  alias: v.string(),
  prefix: DirectoryPathPrefixSchema,
})

export type IpcErrorCode = 'FORBIDDEN' | 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR'

/** Error type for the native Electron bridge IPC layer. */
export class IpcError extends Error {
  readonly code: string

  constructor(options: { code: IpcErrorCode | string; message: string }) {
    super(options.message)
    this.name = 'IpcError'
    this.code = options.code
  }
}

type IpcInputSchema<TInput> = v.BaseSchema<unknown, TInput, v.BaseIssue<unknown>>

function parseIpcInput<TInput>(schema: IpcInputSchema<TInput>, input: unknown): TInput {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new IpcError({ code: 'BAD_REQUEST', message: 'Invalid IPC input' })
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
