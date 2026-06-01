import { initTRPC } from '@trpc/server'
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
import { SETTINGS_PAGES, type SettingsPage } from '#/shared/settings-pages.ts'
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
}

export interface SettingsSnapshot {
  theme: ThemePref
  colorTheme: ColorTheme
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  toggleDetailOnActionBarBlankClick: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  terminalApp: TerminalPref
  editorApp: EditorPref
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

export interface CommitMeta {
  hash: string
  shortHash: string
  subject: string
  body: string
  author: string
  email: string
  date: string
  parents: string[]
}

export interface CommitFileStat {
  added: number
  deleted: number
  path: string
  binary: boolean
}

export interface CommitDetail {
  meta: CommitMeta
  files: CommitFileStat[]
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
  | 'tab-changes'
  | 'tab-log'
  | 'tab-terminal'
  | 'toggle-detail'
  | 'reset-layout'
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
  | { type: 'terminal-bell-click'; repoRoot: string }
  | { type: 'i18n-changed'; payload: I18nPayload }

export interface AppRpcHandlers {
  app: {
    openProjectGitHub: () => Promise<ExecResult>
    openExternalUrl: (input: { url: string }) => Promise<ExecResult>
    openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<void>
  }
  repo: {
    openDialog: () => Promise<string | null>
    consumeExternalOpenPaths: () => Promise<string[]>
    cloneParentDialog: () => Promise<string | null>
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
    log: (input: { cwd: string; branch: string; count?: number; skip?: number }) => Promise<LogEntry[]>
    status: (input: { cwd: string }) => Promise<WorktreeStatus[]>
    patch: (input: { cwd: string; worktreePath: string }) => Promise<ExecResult>
    commit: (input: { cwd: string; hash: string }) => Promise<CommitDetail | null>
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
    openInFinder: (input: { path: string }) => Promise<ExecResult>
    openTerminal: (input: { path: string }) => Promise<ExecResult>
    openEditor: (input: { path: string }) => Promise<ExecResult>
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
    get: (input?: { hosts?: string[] }) => Promise<GitHubCliState>
    refresh: (input?: { hosts?: string[] }) => Promise<GitHubCliState>
  }
  i18n: {
    get: () => Promise<I18nPayload>
    setPref: (input: { pref: LangPref }) => Promise<I18nPayload | null>
  }
}

const t = initTRPC.create()
const p = t.procedure

const EmptyInput = v.optional(v.void())
const FiniteNumber = v.pipe(v.number(), v.finite())
const PortNumber = v.pipe(FiniteNumber, v.integer(), v.minValue(1), v.maxValue(65535))
const CwdInput = v.object({ cwd: v.string() })
const PathInput = v.object({ path: v.string() })
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

export function createAppRouter(handlers: AppRpcHandlers) {
  return t.router({
    app: t.router({
      openProjectGitHub: p.input(EmptyInput).mutation(() => handlers.app.openProjectGitHub()),
      openExternalUrl: p
        .input(v.object({ url: v.string() }))
        .mutation(({ input }) => handlers.app.openExternalUrl(input)),
      openSettingsWindow: p
        .input(v.optional(v.object({ page: v.optional(v.picklist(SETTINGS_PAGES)) })))
        .mutation(({ input }) => handlers.app.openSettingsWindow(input)),
    }),
    repo: t.router({
      openDialog: p.input(EmptyInput).mutation(() => handlers.repo.openDialog()),
      consumeExternalOpenPaths: p.input(EmptyInput).mutation(() => handlers.repo.consumeExternalOpenPaths()),
      cloneParentDialog: p.input(EmptyInput).mutation(() => handlers.repo.cloneParentDialog()),
      probe: p.input(CwdInput).query(({ input }) => handlers.repo.probe(input)),
      clone: p
        .input(
          v.object({ operationId: v.string(), url: v.string(), parentPath: v.string(), directoryName: v.string() }),
        )
        .mutation(({ input }) => handlers.repo.clone(input)),
      abortClone: p
        .input(v.object({ operationId: v.string() }))
        .mutation(({ input }) => handlers.repo.abortClone(input)),
      snapshot: p.input(CwdInput).query(({ input }) => handlers.repo.snapshot(input)),
      pullRequests: p
        .input(
          v.object({
            cwd: v.string(),
            branches: v.optional(v.array(v.string())),
            options: v.optional(
              v.object({
                mode: v.optional(v.picklist(['summary', 'full'])),
                clearMissing: v.optional(v.boolean()),
              }),
            ),
          }),
        )
        .query(({ input }) => handlers.repo.pullRequests(input)),
      log: p
        .input(
          v.object({
            cwd: v.string(),
            branch: v.string(),
            count: v.optional(FiniteNumber),
            skip: v.optional(FiniteNumber),
          }),
        )
        .query(({ input }) => handlers.repo.log(input)),
      status: p.input(CwdInput).query(({ input }) => handlers.repo.status(input)),
      patch: p
        .input(v.object({ cwd: v.string(), worktreePath: v.string() }))
        .mutation(({ input }) => handlers.repo.patch(input)),
      commit: p
        .input(v.object({ cwd: v.string(), hash: v.string() }))
        .query(({ input }) => handlers.repo.commit(input)),
      checkout: p.input(BranchInput).mutation(({ input }) => handlers.repo.checkout(input)),
      deleteBranch: p
        .input(
          v.object({
            cwd: v.string(),
            branch: v.string(),
            force: v.optional(v.boolean()),
            alsoDeleteUpstream: v.optional(v.boolean()),
          }),
        )
        .mutation(({ input }) => handlers.repo.deleteBranch(input)),
      removeWorktree: p
        .input(
          v.object({
            cwd: v.string(),
            branch: v.string(),
            worktreePath: v.string(),
            alsoDeleteBranch: v.boolean(),
            forceDeleteBranch: v.optional(v.boolean()),
            alsoDeleteUpstream: v.optional(v.boolean()),
          }),
        )
        .mutation(({ input }) => handlers.repo.removeWorktree(input)),
      createWorktree: p
        .input(v.object({ cwd: v.string(), worktreePath: v.string(), newBranch: v.string(), baseBranch: v.string() }))
        .mutation(({ input }) => handlers.repo.createWorktree(input)),
      pull: p
        .input(v.object({ cwd: v.string(), branch: v.string(), worktreePath: v.optional(v.string()) }))
        .mutation(({ input }) => handlers.repo.pull(input)),
      push: p.input(BranchInput).mutation(({ input }) => handlers.repo.push(input)),
      fetch: p
        .input(v.object({ cwd: v.string(), kind: v.optional(v.picklist(['user', 'background'])) }))
        .mutation(({ input }) => handlers.repo.fetch(input)),
      abort: p.input(CwdInput).mutation(({ input }) => handlers.repo.abort(input)),
      openRemote: p
        .input(v.object({ cwd: v.string(), branch: v.optional(v.string()) }))
        .mutation(({ input }) => handlers.repo.openRemote(input)),
      openInFinder: p.input(PathInput).mutation(({ input }) => handlers.repo.openInFinder(input)),
      openTerminal: p.input(PathInput).mutation(({ input }) => handlers.repo.openTerminal(input)),
      openEditor: p.input(PathInput).mutation(({ input }) => handlers.repo.openEditor(input)),
    }),
    remote: t.router({
      listSshHosts: p.input(EmptyInput).query(() => handlers.remote.listSshHosts()),
      resolveTarget: p
        .input(RemoteConnectionInputSchema)
        .query(({ input }) => handlers.remote.resolveTarget(input)),
      listPathSuggestions: p
        .input(RemotePathSuggestionsInputSchema)
        .query(({ input }) => handlers.remote.listPathSuggestions(input)),
      testRepository: p
        .input(v.object({ target: RemoteTargetSchema }))
        .query(({ input }) => handlers.remote.testRepository(input)),
    }),
    theme: t.router({
      get: p.input(EmptyInput).query(() => handlers.theme.get()),
      setPref: p
        .input(v.object({ pref: v.picklist(['auto', 'light', 'dark']) }))
        .mutation(({ input }) => handlers.theme.setPref(input)),
      setColorTheme: p
        .input(v.object({ colorTheme: v.picklist(COLOR_THEMES) }))
        .mutation(({ input }) => handlers.theme.setColorTheme(input)),
    }),
    settings: t.router({
      get: p.input(EmptyInput).query(() => handlers.settings.get()),
      setFetchInterval: p
        .input(v.object({ sec: FiniteNumber }))
        .mutation(({ input }) => handlers.settings.setFetchInterval(input)),
      setTerminalNotificationsEnabled: p
        .input(v.object({ enabled: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setTerminalNotificationsEnabled(input)),
      setShortcutsDisabled: p
        .input(v.object({ disabled: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setShortcutsDisabled(input)),
      setGlobalShortcutDisabled: p
        .input(v.object({ disabled: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setGlobalShortcutDisabled(input)),
      setSwapCloseShortcuts: p
        .input(v.object({ swapped: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setSwapCloseShortcuts(input)),
      setToggleDetailOnActionBarBlankClick: p
        .input(v.object({ enabled: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setToggleDetailOnActionBarBlankClick(input)),
      setGlobalShortcut: p
        .input(v.object({ accelerator: v.string() }))
        .mutation(({ input }) => handlers.settings.setGlobalShortcut(input)),
      setTerminalApp: p
        .input(v.object({ pref: v.picklist(['auto', 'ghostty', 'terminal']) }))
        .mutation(({ input }) => handlers.settings.setTerminalApp(input)),
      setEditorApp: p
        .input(v.object({ pref: v.picklist(['auto', 'vscode', 'cursor', 'windsurf']) }))
        .mutation(({ input }) => handlers.settings.setEditorApp(input)),
      saveSession: p
        .input(
          v.object({
            session: v.object({
              openRepos: v.array(RepoSessionEntrySchema),
              activeRepo: v.nullable(v.string()),
              detailCollapsed: v.boolean(),
              detailFocusMode: v.boolean(),
              workspaceLayout: v.picklist(WORKSPACE_LAYOUTS),
              detailPaneSizes: v.object({
                'top-bottom': FiniteNumber,
                'left-right': FiniteNumber,
              }),
            }),
          }),
        )
        .mutation(({ input }) => handlers.settings.saveSession(input)),
      addRecentRepo: p
        .input(v.object({ repo: RepoSessionEntrySchema }))
        .mutation(({ input }) => handlers.settings.addRecentRepo(input)),
      clearRecentRepos: p.input(EmptyInput).mutation(() => handlers.settings.clearRecentRepos()),
    }),
    externalApps: t.router({
      get: p.input(EmptyInput).query(() => handlers.externalApps.get()),
      refresh: p.input(EmptyInput).mutation(() => handlers.externalApps.refresh()),
    }),
    githubCli: t.router({
      get: p
        .input(v.optional(v.object({ hosts: v.optional(v.array(v.string())) })))
        .query(({ input }) => handlers.githubCli.get(input)),
      refresh: p
        .input(v.optional(v.object({ hosts: v.optional(v.array(v.string())) })))
        .mutation(({ input }) => handlers.githubCli.refresh(input)),
    }),
    i18n: t.router({
      get: p.input(EmptyInput).query(() => handlers.i18n.get()),
      setPref: p
        .input(v.object({ pref: v.picklist(['auto', 'en', 'zh', 'ko', 'ja']) }))
        .mutation(({ input }) => handlers.i18n.setPref(input)),
    }),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
