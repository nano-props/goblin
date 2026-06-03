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
import { WORKSPACE_LAYOUTS } from '#/shared/workspace-layout.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import type { WorkspaceDetailPaneSizes, WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
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

export type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
export type { SettingsPage } from '#/shared/settings-pages.ts'

export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type LangPref = 'auto' | 'en' | 'zh' | 'ko' | 'ja'
export type Lang = 'en' | 'zh' | 'ko' | 'ja'
export type TerminalPref = 'auto' | 'ghostty' | 'terminal'
export type EditorPref = 'auto' | 'vscode' | 'cursor' | 'windsurf'
export type ResolvedTerminalApp = Exclude<TerminalPref, 'auto'>
export type ResolvedEditorApp = Exclude<EditorPref, 'auto'>
export type TerminalAppAvailability = Record<ResolvedTerminalApp, boolean>
export type EditorAppAvailability = Record<ResolvedEditorApp, boolean>
export type NetworkOpKind = 'user' | 'background'

export interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
  colorTheme: ColorTheme
}

export interface SessionState {
  /** Repo entries that were open, in tab order. */
  openRepos: RepoSessionEntry[]
  /** The active tab id — null when no repos were open. */
  activeRepo: string | null
  detailCollapsed: boolean
  detailFocusMode: boolean
  workspaceLayout: WorkspaceLayout
  detailPaneSizes: WorkspaceDetailPaneSizes
  selectedTerminalByWorktree?: Record<string, string>
}

export interface SettingsPrefs {
  theme: ThemePref
  colorTheme: ColorTheme
  lang: LangPref
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  toggleDetailOnActionBarBlankClick: boolean
  globalShortcut: string
  terminalApp: TerminalPref
  editorApp: EditorPref
}

export interface SettingsSnapshot extends Omit<SettingsPrefs, 'lang'> {
  globalShortcutRegistered: boolean
  session: SessionState
  recentRepos: RepoSessionEntry[]
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
  pref: TerminalPref
  resolved: ResolvedTerminalApp | null
  available: boolean
  appAvailability: TerminalAppAvailability
  detectedAt: number
}

export interface EditorAppState {
  pref: EditorPref
  resolved: ResolvedEditorApp | null
  available: boolean
  appAvailability: EditorAppAvailability
  detectedAt: number
}

export interface ExternalAppsSnapshot {
  terminal: TerminalAppState
  editor: EditorAppState
}

export interface I18nPayload {
  lang: Lang
  pref: LangPref
  dict: Record<string, string>
}

export interface RepoSnapshot {
  branches: BranchSnapshotInfo[]
  current: string
  remote?: RepoRemoteInfo
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

export interface RpcRequest {
  path: string
  input?: unknown
  requestId?: string
}

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; code?: string; name?: string } }

export type MenuAction =
  | 'open-repo'
  | 'open-repo-path'
  | 'open-remote-repo'
  | 'clone-repo'
  | 'close-repo'
  | 'next-repo'
  | 'prev-repo'
  | 'refresh'
  | 'tab-status'
  | 'tab-terminal'
  | 'terminal-primary-action'
  | 'toggle-detail'
  | 'reset-layout'
  | { type: 'open-settings'; page: SettingsPage }
  | { type: 'open-recent-repo'; entry: RepoSessionEntry }
  | { type: 'set-workspace-layout'; layout: WorkspaceLayout }

export type RpcEvent =
  | { type: 'theme-changed'; state: ThemeState }
  | { type: 'fetch-interval-changed'; sec: number }
  | { type: 'terminal-notifications-changed'; enabled: boolean }
  | { type: 'shortcuts-disabled-changed'; disabled: boolean }
  | { type: 'global-shortcut-disabled-changed'; disabled: boolean }
  | { type: 'swap-close-shortcuts-changed'; swapped: boolean }
  | { type: 'toggle-detail-on-action-bar-blank-click-changed'; enabled: boolean }
  | { type: 'global-shortcut-changed'; state: GlobalShortcutState }
  | ({ type: 'terminal-app-changed' } & TerminalAppState)
  | ({ type: 'editor-app-changed' } & EditorAppState)
  | { type: 'github-cli-changed'; state: GitHubCliState }
  | { type: 'settings-write-error'; message: string }
  | { type: 'external-open-enqueued' }
  | { type: 'menu-action'; action: MenuAction }
  | { type: 'terminal-bell-click'; repoRoot: string; key?: string }
  | { type: 'i18n-changed'; payload: I18nPayload }
  | RepoQueryInvalidationEvent

export interface AppRpcHandlers {
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
    checkout: (input: { cwd: string; branch: string }) => Promise<ExecResult>
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
    createWorktree: (input: {
      cwd: string
      worktreePath: string
      newBranch: string
      baseBranch: string
    }) => Promise<ExecResult>
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
    testRepository: (input: { target: RemoteRepoTarget }) => Promise<RemoteDiagnosticsResult>
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
    setSwapCloseShortcuts: (input: { swapped: boolean }) => Promise<void>
    setToggleDetailOnActionBarBlankClick: (input: { enabled: boolean }) => Promise<void>
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
    setTerminalApp: (input: { pref: TerminalPref }) => Promise<TerminalAppState>
    setEditorApp: (input: { pref: EditorPref }) => Promise<EditorAppState>
    saveSession: (input: { session: SessionState }) => Promise<void>
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
    get: () => Promise<I18nPayload>
    setPref: (input: { pref: LangPref }) => Promise<I18nPayload | null>
  }
}

const EmptyInput = v.optional(v.void())
const FiniteNumber = v.pipe(v.number(), v.finite())
const PortNumber = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))
const CwdInput = v.object({ cwd: v.string() })
const BranchInput = v.object({ cwd: v.string(), branch: v.string() })

const RemoteAbsolutePath = v.pipe(
  v.string(),
  v.check((value) => value.startsWith('/') && !value.includes('\0'), 'Invalid remote path'),
)

const RemoteTargetSchema = v.object({
  id: v.string(),
  alias: v.string(),
  host: v.string(),
  user: v.string(),
  port: PortNumber,
  remotePath: RemoteAbsolutePath,
  displayName: v.string(),
})

const RemoteRepoRefSchema = v.object({
  id: v.string(),
  alias: v.string(),
  remotePath: RemoteAbsolutePath,
  displayName: v.string(),
})

const RepoSessionEntrySchema = v.union([
  v.object({
    kind: v.literal('local'),
    id: v.string(),
  }),
  v.object({
    kind: v.literal('remote'),
    id: v.string(),
    ref: RemoteRepoRefSchema,
  }),
])

const RemoteConnectionInputSchema = v.object({
  alias: v.string(),
  remotePath: v.string(),
})

const RemotePathSuggestionsInputSchema = v.object({
  alias: v.string(),
  remotePath: v.string(),
  prefix: v.string(),
})

export type RpcErrorCode = 'FORBIDDEN' | 'BAD_REQUEST' | 'NOT_FOUND' | 'INTERNAL_SERVER_ERROR'

export class RpcError extends Error {
  readonly code: string

  constructor(options: { code: RpcErrorCode | string; message: string }) {
    super(options.message)
    this.name = 'RpcError'
    this.code = options.code
  }
}

type ValibotSchema = Parameters<typeof v.safeParse>[0]

type AppRpcProcedureSchemas = {
  [NS in keyof AppRpcHandlers]: { [Proc in keyof AppRpcHandlers[NS]]: ValibotSchema }
}

export const RPC_PROCEDURE_SCHEMAS: AppRpcProcedureSchemas = {
  repo: {
    probe: CwdInput,
    clone: v.object({ operationId: v.string(), url: v.string(), parentPath: v.string(), directoryName: v.string() }),
    abortClone: v.object({ operationId: v.string() }),
    snapshot: CwdInput,
    pullRequests: v.object({
      cwd: v.string(),
      branches: v.optional(v.array(v.string())),
      options: v.optional(
        v.object({ mode: v.optional(v.picklist(['summary', 'full'])), clearMissing: v.optional(v.boolean()) }),
      ),
    }),
    status: CwdInput,
    patch: v.object({ cwd: v.string(), worktreePath: v.string() }),
    checkout: BranchInput,
    deleteBranch: v.object({
      cwd: v.string(),
      branch: v.string(),
      force: v.optional(v.boolean()),
      alsoDeleteUpstream: v.optional(v.boolean()),
    }),
    removeWorktree: v.object({
      cwd: v.string(),
      branch: v.string(),
      worktreePath: v.string(),
      alsoDeleteBranch: v.boolean(),
      forceDeleteBranch: v.optional(v.boolean()),
      alsoDeleteUpstream: v.optional(v.boolean()),
    }),
    createWorktree: v.object({
      cwd: v.string(),
      worktreePath: v.string(),
      newBranch: v.string(),
      baseBranch: v.string(),
    }),
    pull: v.object({ cwd: v.string(), branch: v.string(), worktreePath: v.optional(v.string()) }),
    push: BranchInput,
    fetch: v.object({ cwd: v.string(), kind: v.optional(v.picklist(['user', 'background'])) }),
    abort: CwdInput,
    openRemote: v.object({ cwd: v.string(), branch: v.optional(v.string()) }),
  },
  remote: {
    listSshHosts: EmptyInput,
    resolveTarget: RemoteConnectionInputSchema,
    listPathSuggestions: RemotePathSuggestionsInputSchema,
    testRepository: v.object({ target: RemoteTargetSchema }),
  },
  theme: {
    get: EmptyInput,
    setPref: v.object({ pref: v.picklist(['auto', 'light', 'dark']) }),
    setColorTheme: v.object({ colorTheme: v.picklist(COLOR_THEMES) }),
  },
  settings: {
    get: EmptyInput,
    setFetchInterval: v.object({ sec: FiniteNumber }),
    setTerminalNotificationsEnabled: v.object({ enabled: v.boolean() }),
    setShortcutsDisabled: v.object({ disabled: v.boolean() }),
    setGlobalShortcutDisabled: v.object({ disabled: v.boolean() }),
    setSwapCloseShortcuts: v.object({ swapped: v.boolean() }),
    setToggleDetailOnActionBarBlankClick: v.object({ enabled: v.boolean() }),
    setGlobalShortcut: v.object({ accelerator: v.string() }),
    setTerminalApp: v.object({ pref: v.picklist(['auto', 'ghostty', 'terminal']) }),
    setEditorApp: v.object({ pref: v.picklist(['auto', 'vscode', 'cursor', 'windsurf']) }),
    saveSession: v.object({
      session: v.object({
        openRepos: v.array(RepoSessionEntrySchema),
        activeRepo: v.nullable(v.string()),
        detailCollapsed: v.boolean(),
        detailFocusMode: v.boolean(),
        workspaceLayout: v.picklist(WORKSPACE_LAYOUTS),
        detailPaneSizes: v.object({ 'top-bottom': FiniteNumber, 'left-right': FiniteNumber }),
        selectedTerminalByWorktree: v.optional(v.record(v.string(), v.string())),
      }),
    }),
    addRecentRepo: v.object({ repo: RepoSessionEntrySchema }),
    clearRecentRepos: EmptyInput,
  },
  externalApps: {
    get: EmptyInput,
    refresh: EmptyInput,
  },
  githubCli: {
    get: v.optional(v.object({ hosts: v.optional(v.array(v.string())) })),
    refresh: v.optional(v.object({ hosts: v.optional(v.array(v.string())) })),
  },
  i18n: {
    get: EmptyInput,
    setPref: v.object({ pref: v.picklist(['auto', 'en', 'zh', 'ko', 'ja']) }),
  },
}

function parseRpcInput<T>(schema: ValibotSchema, input: unknown): T {
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) throw new RpcError({ code: 'BAD_REQUEST', message: 'Invalid RPC input' })
  return parsed.output as T
}

function createValidatedProcedure<TInput, TOutput>(
  schema: ValibotSchema,
  handler: (input: TInput) => Promise<TOutput> | TOutput,
): (input: unknown) => Promise<TOutput> {
  return async (input: unknown) => await handler(parseRpcInput<TInput>(schema, input))
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
    repo: {
      [K in keyof AppRpcHandlers['repo']]: (input: unknown) => Promise<Awaited<ReturnType<AppRpcHandlers['repo'][K]>>>
    }
    remote: {
      [K in keyof AppRpcHandlers['remote']]: (
        input: unknown,
      ) => Promise<Awaited<ReturnType<AppRpcHandlers['remote'][K]>>>
    }
    theme: {
      [K in keyof AppRpcHandlers['theme']]: (input: unknown) => Promise<Awaited<ReturnType<AppRpcHandlers['theme'][K]>>>
    }
    settings: {
      [K in keyof AppRpcHandlers['settings']]: (
        input: unknown,
      ) => Promise<Awaited<ReturnType<AppRpcHandlers['settings'][K]>>>
    }
    externalApps: {
      [K in keyof AppRpcHandlers['externalApps']]: (
        input: unknown,
      ) => Promise<Awaited<ReturnType<AppRpcHandlers['externalApps'][K]>>>
    }
    githubCli: {
      [K in keyof AppRpcHandlers['githubCli']]: (
        input: unknown,
      ) => Promise<Awaited<ReturnType<AppRpcHandlers['githubCli'][K]>>>
    }
    i18n: {
      [K in keyof AppRpcHandlers['i18n']]: (input: unknown) => Promise<Awaited<ReturnType<AppRpcHandlers['i18n'][K]>>>
    }
  }
}

export function createAppRouter(handlers: AppRpcHandlers): AppRouter {
  return {
    createCaller: () => ({
      repo: createValidatedNamespace(handlers.repo, RPC_PROCEDURE_SCHEMAS.repo),
      remote: createValidatedNamespace(handlers.remote, RPC_PROCEDURE_SCHEMAS.remote),
      theme: createValidatedNamespace(handlers.theme, RPC_PROCEDURE_SCHEMAS.theme),
      settings: createValidatedNamespace(handlers.settings, RPC_PROCEDURE_SCHEMAS.settings),
      externalApps: createValidatedNamespace(handlers.externalApps, RPC_PROCEDURE_SCHEMAS.externalApps),
      githubCli: createValidatedNamespace(handlers.githubCli, RPC_PROCEDURE_SCHEMAS.githubCli),
      i18n: createValidatedNamespace(handlers.i18n, RPC_PROCEDURE_SCHEMAS.i18n),
    }),
  }
}
