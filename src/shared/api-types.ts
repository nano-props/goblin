// HTTP API response types and native bridge IPC types shared by
// main, server, and client. Domain types live in their own
// modules (#/shared/git-types.ts, #/shared/settings.ts, etc.);
// this file aggregates what crosses process/transport boundaries.

import * as v from 'valibot'
import type {
  BranchSnapshotInfo,
  ExecResult,
  LogEntry,
  PullRequestFetchMode,
  PullRequestInfo,
  RepoRemoteInfo,
  WorktreeStatus,
} from '#/shared/git-types.ts'
import type { WorkspacePaneSessionTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import type {
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
import type {
  RemoteConnectionInput,
  RemoteDiagnosticsResult,
  RemotePathSuggestionsInput,
  RepoSessionEntry,
  RemoteRepoTarget,
  ResolvedRemoteTarget,
  SshConfigHost,
  SshConfigHostsResult,
} from '#/shared/remote-repo.ts'
import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { type NativeHostProjection } from '#/shared/native-host-projection.ts'
import { RemoteAbsolutePathSchema } from '#/shared/remote-repo-schema.ts'
import type { CreateWorktreeIpcInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'

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
  NativeRecentReposProjection,
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

export interface WorkspaceSessionState {
  /** Repo entries that were open, in switcher order. */
  openRepoEntries: RepoSessionEntry[]
  /** The active repository id — null when no repos were open. */
  activeRepoId: string | null
  zenMode: boolean
  workspacePaneSize: number
  selectedTerminalSessionByWorktree?: Record<string, string>
  /** Per-repo, per-branch workspace pane tab preference that session restore can make renderable. */
  preferredWorkspacePaneTabByBranchByRepo?: Record<string, Record<string, WorkspacePaneSessionTabType>>
  /** Per-repo, per-branch workspace pane tab strip order. Empty arrays are meaningful. */
  workspacePaneTabOrderByBranchByRepo: Record<string, Record<string, WorkspacePaneTabOrderEntry[]>>
  /** Per-repo, per-worktree file tree view state. */
  filetreeViewStateByWorktreeByRepo?: Record<string, Record<string, FiletreeSessionViewState>>
}

export interface FiletreeSessionViewState {
  selectedKeys: string[]
  expandedKeys: string[]
  topVisibleRowIndex: number
}

export interface RuntimeSettingsSnapshot extends UserSettings {
  globalShortcutRegistered: boolean
}

export type RepoLogResponse = LogEntry[] | { ok: false; message: string }

export interface RuntimeRecentReposState {
  recentRepos: RepoSessionEntry[]
}

export interface RepoSettingsState {
  repoSettings: RepoSettingsEntry[]
}

export interface SettingsSnapshot extends RuntimeSettingsSnapshot, RuntimeRecentReposState, RepoSettingsState {
  session: WorkspaceSessionState
}

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
}

export interface RepoTreeResult {
  readonly nodes: ReadonlyArray<RepoTreeNode>
  /** True if the result was truncated by `depth` or a node-count cap. */
  readonly truncated: boolean
}

export type RepoFileViewer = 'bat' | 'cat' | 'type'
export type RepoFileViewerShell = 'posix' | 'cmd'

export interface RepoFileViewerResult {
  readonly viewer: RepoFileViewer
  readonly shell: RepoFileViewerShell
}

export interface ProbeResult {
  ok: boolean
  root?: string
  name?: string
  message?: string
}

export interface CloneRepoResult extends ExecResult {
  path?: string
}

export interface PullRequestEntry {
  branch: string
  pullRequest: PullRequestInfo
}

export interface PullRequestFetchOptions {
  mode?: PullRequestFetchMode
  clearMissing?: boolean
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
  repo: {
    probe: (input: { cwd: string }) => Promise<ProbeResult>
    clone: (input: {
      operationId: string
      url: string
      parentPath: string
      directoryName: string
    }) => Promise<CloneRepoResult>
    abortClone: (input: { operationId: string }) => Promise<boolean>
    snapshot: (input: { cwd: string }) => Promise<RepoSnapshot | null>
    pullRequests: (input: {
      cwd: string
      branches?: string[]
      options?: PullRequestFetchOptions
    }) => Promise<PullRequestEntry[] | null>
    status: (input: { cwd: string }) => Promise<WorktreeStatus[]>
    patch: (input: { cwd: string; worktreePath: string }) => Promise<ExecResult>
    trashFile: (input: { cwd: string; worktreePath: string; path: string }) => Promise<ExecResult>
    deleteBranch: (input: {
      cwd: string
      branch: string
      force?: boolean
      alsoDeleteUpstream?: boolean
    }) => Promise<ExecResult>
    removeWorktree: (input: {
      cwd: string
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
      alsoDeleteUpstream?: boolean
    }) => Promise<ExecResult>
    createWorktree: (input: CreateWorktreeIpcInput) => Promise<ExecResult>
    worktreeBootstrapPreview: (input: { cwd: string }) => Promise<WorktreeBootstrapPreviewResult>
    remoteBranches: (input: { cwd: string }) => Promise<string[]>
    pull: (input: { cwd: string; branch: string; worktreePath?: string }) => Promise<ExecResult>
    push: (input: { cwd: string; branch: string }) => Promise<ExecResult>
    fetch: (input: { cwd: string; kind?: NetworkOpKind }) => Promise<ExecResult>
    abort: (input: { cwd: string }) => Promise<boolean>
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
    saveSession: (input: { session: WorkspaceSessionState }) => Promise<void>
    applyNativeHostProjection: (input: NativeHostProjection) => Promise<void>
    addRecentRepo: (input: { repo: RepoSessionEntry }) => Promise<RepoSessionEntry[]>
    clearRecentRepos: () => Promise<void>
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
  settings: {
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
    applyNativeHostProjection: (input: NativeHostProjection) => Promise<void>
  }
}

export type NativeHostIpcPath = {
  [NS in keyof NativeHostIpcHandlers]: `${Extract<NS, string>}.${Extract<keyof NativeHostIpcHandlers[NS], string>}`
}[keyof NativeHostIpcHandlers]

const EmptyInput = v.optional(v.void())
const FiniteNumber = v.pipe(v.number(), v.finite())
const PortNumber = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))

/** Primitive valibot schema for `{ cwd: string }`. */
export const CwdInput = v.object({ cwd: v.string() })

/** Primitive valibot schema for `{ cwd, branch }`. */
export const BranchInput = v.object({ cwd: v.string(), branch: v.string() })

export const RemoteTargetSchema = v.object({
  id: v.string(),
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

export interface AppRouter {
  createCaller: () => {
    settings: {
      [K in keyof NativeHostIpcHandlers['settings']]: (
        input: unknown,
      ) => Promise<Awaited<ReturnType<NativeHostIpcHandlers['settings'][K]>>>
    }
  }
}

type NativeHostIpcProcedureSchemas = {
  [NS in keyof NativeHostIpcHandlers]: { [Proc in keyof NativeHostIpcHandlers[NS]]: ValibotSchema }
}

export function createAppRouter(handlers: NativeHostIpcHandlers, schemas: NativeHostIpcProcedureSchemas): AppRouter {
  return {
    createCaller: () => ({
      settings: createValidatedNamespace(handlers.settings, schemas.settings),
    }),
  }
}
