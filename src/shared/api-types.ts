// HTTP API response types and native bridge IPC types shared by
// main, server, and client. Domain types live in their own
// modules (#/shared/git-types.ts, #/shared/settings.ts, etc.);
// this file aggregates what crosses process/transport boundaries.

import * as v from 'valibot'
import { WorkspaceIdSchema } from '#/shared/workspace-locator-schema.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
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
  RemotePathSuggestionsInput,
  WorkspaceSessionEntry,
  RemoteRepoTarget,
  RemoteRepoRuntimeLifecycle,
  ResolvedRemoteTarget,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { type NativeHostProjection } from '#/shared/native-host-projection.ts'
import { RemoteAbsolutePathSchema } from '#/shared/remote-repo-schema.ts'
import type { CreateWorktreeIpcInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'
import type { WorkspaceCapabilities, WorkspaceProbeState } from '#/shared/workspace-runtime.ts'

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
export type { RepoSettingsEntry, WorktreeBootstrapTrust, WorkspaceExternalAppRecent } from '#/shared/repo-settings.ts'

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
  /** User-level repository membership, in picker order. */
  openWorkspaceEntries: WorkspaceSessionEntry[]
  /** Per-repo, per-target workspace pane layout that survives a server restart. */
  workspacePaneTabsByTargetByWorkspace: Record<string, Record<string, WorkspacePaneStaticTabEntry[]>>
}

export interface ClientWorkspaceState {
  /** Repo id restored when opening `/` — null when no repos were open. */
  restoredWorkspaceId: WorkspaceId | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>
  /** Per-repo, per-target workspace pane tab preference that session restore can make renderable. */
  preferredWorkspacePaneTabByTargetByWorkspace: Record<string, Record<string, WorkspacePaneSessionTabType | null>>
  /** Per-repo, per-worktree file tree view state. */
  filetreeViewStateByWorktreeByWorkspace: Record<string, Record<string, FiletreeSessionViewState>>
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
  remoteLifecycle?: RemoteRepoRuntimeLifecycle | null
  workspaceProbe: WorkspaceProbeState
}

export interface WorkspaceRuntimesSnapshot {
  runtimes: WorkspaceRuntimeEntry[]
}

export interface WorkspaceRuntimeMembershipReconcileResult {
  runtimes: WorkspaceRuntimeEntry[]
}

interface RestoredWorkspaceRuntimeBase {
  entry: WorkspaceSessionEntry
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  name: string
  workspaceProbe: WorkspaceProbeState
  target?: RemoteRepoTarget
}

export interface ProjectedRestoredWorkspaceRuntime extends RestoredWorkspaceRuntimeBase {
  projection: WorkspaceRuntimeProjection
}

export interface StubRestoredWorkspaceRuntime extends RestoredWorkspaceRuntimeBase {
  // Stub leases have a validated runtime identity but no projection. They are
  // projected lazily when the user navigates to the repo.
  projection: null
}

export type RestoredWorkspaceRuntime = ProjectedRestoredWorkspaceRuntime | StubRestoredWorkspaceRuntime

export function isProjectedRestoredWorkspaceRuntime(
  repo: RestoredWorkspaceRuntime,
): repo is ProjectedRestoredWorkspaceRuntime {
  return repo.projection !== null
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

export interface RepoSettingsState {
  repoSettings: RepoSettingsEntry[]
}

export interface SettingsSnapshot extends RuntimeSettingsSnapshot, RuntimeRecentWorkspacesState, RepoSettingsState {}

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
  externalApps?: ExternalAppsSnapshot
}

export interface RepoSnapshot {
  branches: BranchSnapshotInfo[]
  current: string
  /** Short commit hash when HEAD is detached (no branch checked out). */
  currentHEAD?: string
  remote?: RepoRemoteInfo
}

// Worktree-scoped file tree types — see docs/filetree.md. Wire and
// domain shapes coincide in v1; if they diverge, move these into a
// dedicated `src/shared/filetree.ts` and map at the hook boundary.

export type RepoTreeNodeStatus = 'clean' | 'modified' | 'staged' | 'untracked' | 'ignored'

export interface RepoTreeNode {
  /** Stable id: relative POSIX path inside the worktree. */
  readonly id: string
  /** Relative POSIX path inside the worktree (matches id; named for readability). */
  readonly path: string
  /** Final path segment, used as the display name. */
  readonly name: string
  readonly parentId: string | null
  readonly kind: 'directory' | 'file'
  readonly status: RepoTreeNodeStatus
  /** Present for lazily-loaded directory rows when the server knows the directory has children. */
  readonly hasChildren?: boolean
}

export interface RepoTreeResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  /** True if the direct-children result was truncated by the node-count cap. */
  readonly truncated: boolean
}

export type RepoFileViewer = 'bat' | 'batcat' | 'cat' | 'type'
export type RepoFileViewerShell = 'posix' | 'cmd'

export interface RepoFileViewerResult {
  readonly viewer: RepoFileViewer
  readonly shell: RepoFileViewerShell
  readonly executionRoot: string
}

export interface ProbeResult {
  ok: boolean
  root?: string
  name?: string
  message?: string
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
  'caller-abort' | 'user-cancel' | 'request-watchdog-timeout' | 'git-timeout' | 'network-op-superseded'
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
  repoId: string | null
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
  loadedAt: number
}

export interface WorkspaceRuntimeProjection {
  snapshot: RepoSnapshot | null
  pullRequests: PullRequestEntry[] | null
  operations: RepoOperationsSnapshot
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

export type { RemoteRepoTarget } from '#/shared/remote-repo.ts'
export { isRemoteRepoId, parseRemoteRepoId } from '#/shared/remote-repo.ts'

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
      input: ({ workspaceId: string } | { workspaceInput: string }) & { clientId: string },
    ) => Promise<WorkspaceRuntimeOpenResponse>
    runtimeReconcile: (input: {
      clientId: string
      workspaceIds: string[]
    }) => Promise<WorkspaceRuntimeMembershipReconcileResult>
    runtimeList: () => Promise<WorkspaceRuntimesSnapshot>
    runtimeClose: (input: { workspaceId: string; workspaceRuntimeId: string; clientId: string }) => Promise<{
      ok: boolean
      released: boolean
      runtimeClosed: boolean
    }>
  }
  repo: {
    probe: (input: { cwd: string }) => Promise<ProbeResult>
    clone: (input: { url: string; parentPath: string; directoryName: string }) => Promise<CloneRepoResult>
    projection: (input: {
      cwd: string
      workspaceRuntimeId: string
      branch?: string
      mode?: PullRequestFetchMode
    }) => Promise<WorkspaceRuntimeProjection>
    operations: (input: {
      cwd?: string
      workspaceRuntimeId?: string
      includeSettled?: boolean
    }) => Promise<RepoOperationsSnapshot>
    patch: (input: { cwd: string; workspaceRuntimeId: string; worktreePath: string }) => Promise<ExecResult>
    trashFile: (input: {
      cwd: string
      workspaceRuntimeId: string
      worktreePath: string
      path: string
    }) => Promise<ExecResult>
    deleteBranch: (input: {
      cwd: string
      workspaceRuntimeId: string
      branch: string
      force?: boolean
      deleteUpstream?: boolean
    }) => Promise<ExecResult>
    removeWorktree: (input: {
      cwd: string
      workspaceRuntimeId: string
      branch: string
      worktreePath: string
      deleteBranch: boolean
      forceDeleteBranch?: boolean
      deleteUpstream?: boolean
    }) => Promise<ExecResult>
    createWorktree: (input: CreateWorktreeIpcInput) => Promise<ExecResult>
    worktreeBootstrapPreview: (input: {
      cwd: string
      workspaceRuntimeId: string
    }) => Promise<WorktreeBootstrapPreviewResult>
    remoteBranches: (input: { cwd: string; workspaceRuntimeId: string }) => Promise<string[]>
    pull: (input: {
      cwd: string
      workspaceRuntimeId: string
      branch: string
      worktreePath?: string
    }) => Promise<ExecResult>
    push: (input: { cwd: string; workspaceRuntimeId: string; branch: string }) => Promise<ExecResult>
    fetch: (input: { cwd: string; workspaceRuntimeId: string }) => Promise<ExecResult>
    abort: (input: { cwd: string }) => Promise<boolean>
    openUrl: (input: { cwd: string; workspaceRuntimeId: string; target: RepoUrlTarget }) => Promise<ExecResult>
    openTerminal: (input: {
      repoId: string
      workspaceRuntimeId: string
      worktreePath: string
      app: TerminalApp
    }) => Promise<ExecResult>
    openEditor: (input: {
      repoId: string
      workspaceRuntimeId: string
      worktreePath: string
      app: EditorApp
    }) => Promise<ExecResult>
    openRemote: (input: { cwd: string; branch?: string }) => Promise<ExecResult>
  }
  remote: {
    listSshHosts: () => Promise<SshConfigHostsResult>
    resolveTarget: (input: RemoteConnectionInput) => Promise<ResolvedRemoteTarget>
    listPathSuggestions: (input: RemotePathSuggestionsInput) => Promise<string[]>
    testRepo: (input: { target: RemoteRepoTarget }) => Promise<RemoteDiagnosticsResult>
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
    applyNativeHostProjection: (input: NativeHostProjection) => Promise<void>
    addRecentWorkspace: (input: { repo: WorkspaceSessionEntry }) => Promise<WorkspaceSessionEntry[]>
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
    read: () => Promise<NativeClientWorkspaceReadResult>
    write: (input: ClientWorkspaceState) => Promise<void>
  }
  settings: {
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
    applyNativeHostProjection: (input: NativeHostProjection) => Promise<void>
  }
}

export type NativeHostIpcPath = {
  [NS in keyof NativeHostIpcHandlers]: `${Extract<NS, string>}.${Extract<keyof NativeHostIpcHandlers[NS], string>}`
}[keyof NativeHostIpcHandlers]

const FiniteNumber = v.pipe(v.number(), v.finite())
const PortNumber = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))

/** Primitive valibot schema for `{ cwd: string }`. */
export const CwdInput = v.object({ cwd: WorkspaceIdSchema })

/** Primitive valibot schema for `{ cwd, branch }`. */
export const BranchInput = v.object({ cwd: v.string(), branch: v.string() })

export const RemoteTargetSchema = v.object({
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

export const RemotePathSuggestionsInputSchema = v.object({
  alias: v.string(),
  remotePath: v.string(),
  prefix: v.string(),
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

type ValibotSchema = Parameters<typeof v.safeParse>[0]

function parseIpcInput<T>(schema: ValibotSchema, input: unknown): T {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new IpcError({ code: 'BAD_REQUEST', message: 'Invalid IPC input' })
  return parsed.output as T
}

function createValidatedProcedure<TInput, TOutput>(
  schema: ValibotSchema,
  handler: (input: TInput) => Promise<TOutput> | TOutput,
): (input: unknown) => Promise<TOutput> {
  return async (input: unknown) => await handler(parseIpcInput<TInput>(schema, input))
}

function createValidatedNamespace<THandlers extends Record<string, (...args: never[]) => unknown>>(
  handlers: THandlers,
  schemas: { [K in keyof THandlers]: ValibotSchema },
): { [K in keyof THandlers]: (input: unknown) => Promise<Awaited<ReturnType<THandlers[K]>>> } {
  const procedures = {} as { [K in keyof THandlers]: (input: unknown) => Promise<Awaited<ReturnType<THandlers[K]>>> }
  for (const key of Object.keys(schemas) as Array<keyof THandlers>) {
    const schema = schemas[key]
    const handler = handlers[key]
    procedures[key] = createValidatedProcedure(
      schema,
      async (input: unknown) => await (handler as unknown as (input: unknown) => unknown)(input),
    ) as {
      [K in keyof THandlers]: (input: unknown) => Promise<Awaited<ReturnType<THandlers[K]>>>
    }[typeof key]
  }
  return procedures
}

type AppRouterCaller = {
  [NS in keyof NativeHostIpcHandlers]: {
    [K in keyof NativeHostIpcHandlers[NS]]: NativeHostIpcHandlers[NS][K] extends (...args: never[]) => infer TOutput
      ? (input: unknown) => Promise<Awaited<TOutput>>
      : never
  }
}

export interface AppRouter {
  createCaller: () => AppRouterCaller
}

type NativeHostIpcProcedureSchemas = {
  [NS in keyof NativeHostIpcHandlers]: { [Proc in keyof NativeHostIpcHandlers[NS]]: ValibotSchema }
}

export function createAppRouter(handlers: NativeHostIpcHandlers, schemas: NativeHostIpcProcedureSchemas): AppRouter {
  return {
    createCaller: () => {
      const caller: Record<string, unknown> = {}
      for (const namespace of Object.keys(schemas) as Array<keyof NativeHostIpcHandlers>) {
        caller[namespace] = createValidatedNamespace(handlers[namespace], schemas[namespace])
      }
      return caller as AppRouterCaller
    },
  }
}
