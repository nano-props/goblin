import { initTRPC } from '@trpc/server'
import * as v from 'valibot'
import type {
  BranchInfo,
  ExecResult,
  LogEntry,
  PullRequestFetchMode,
  PullRequestInfo,
  WorktreeStatus,
} from '#/shared/git-types.ts'

export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type LangPref = 'auto' | 'en' | 'zh' | 'ko' | 'ja'
export type Lang = 'en' | 'zh' | 'ko' | 'ja'
export type NetworkOpKind = 'user' | 'background'

export interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
}

export interface SessionState {
  openRepos: string[]
  activeRepo: string | null
  detailCollapsed: boolean
}

export interface SettingsSnapshot {
  theme: ThemePref
  fetchIntervalSec: number
  shortcutsDisabled: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  session: SessionState
  recentRepos: string[]
}

export interface GlobalShortcutState {
  accelerator: string
  registered: boolean
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
  branches: BranchInfo[]
  current: string
}

export interface ProbeResult {
  ok: boolean
  root?: string
  name?: string
  message?: string
}

export interface PullRequestEntry {
  branch: string
  pullRequest: PullRequestInfo
}

export interface PullRequestFetchOptions {
  mode?: PullRequestFetchMode
  silent?: boolean
  clearMissing?: boolean
}

export interface RpcRequest {
  path: string
  input?: unknown
}

export type RpcResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; code?: string; name?: string } }

export type MenuAction =
  | 'open-repo'
  | 'close-repo'
  | 'next-repo'
  | 'prev-repo'
  | 'refresh'
  | 'tab-status'
  | 'tab-changes'
  | 'tab-log'
  | 'toggle-detail'
  | 'toggle-theme'
  | 'open-settings'
  | 'show-help'
  | { type: 'open-recent-repo'; path: string }

export type RpcEvent =
  | { type: 'theme-changed'; state: ThemeState }
  | { type: 'fetch-interval-changed'; sec: number }
  | { type: 'shortcuts-disabled-changed'; disabled: boolean }
  | { type: 'global-shortcut-changed'; state: GlobalShortcutState }
  | { type: 'settings-write-error'; message: string }
  | { type: 'menu-action'; action: MenuAction }
  | { type: 'i18n-changed'; payload: I18nPayload }

export interface AppRpcHandlers {
  app: {
    openProjectGitHub: () => Promise<ExecResult>
  }
  repo: {
    openDialog: () => Promise<string | null>
    probe: (input: { cwd: string }) => Promise<ProbeResult>
    snapshot: (input: { cwd: string }) => Promise<RepoSnapshot | null>
    pullRequests: (input: {
      cwd: string
      branches?: string[]
      options?: PullRequestFetchOptions
    }) => Promise<PullRequestEntry[] | null>
    log: (input: { cwd: string; branch: string; count?: number }) => Promise<LogEntry[]>
    status: (input: { cwd: string }) => Promise<WorktreeStatus[]>
    patch: (input: { cwd: string; worktreePath: string }) => Promise<ExecResult>
    commit: (input: { cwd: string; hash: string }) => Promise<CommitDetail | null>
    checkout: (input: { cwd: string; branch: string }) => Promise<ExecResult>
    deleteBranch: (input: { cwd: string; branch: string; force?: boolean }) => Promise<ExecResult>
    removeWorktree: (input: {
      cwd: string
      branch: string
      worktreePath: string
      alsoDeleteBranch: boolean
      forceDeleteBranch?: boolean
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
    openGitHub: (input: { cwd: string; branch?: string }) => Promise<ExecResult>
    openInFinder: (input: { path: string }) => Promise<ExecResult>
    openInGhostty: (input: { path: string }) => Promise<ExecResult>
    openInVSCode: (input: { path: string }) => Promise<ExecResult>
    ghosttyInstalled: () => Promise<boolean>
    vscodeInstalled: () => Promise<boolean>
  }
  theme: {
    get: () => ThemeState
    setPref: (input: { pref: ThemePref }) => Promise<ThemeState>
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    setFetchInterval: (input: { sec: number }) => Promise<void>
    setShortcutsDisabled: (input: { disabled: boolean }) => Promise<void>
    setGlobalShortcut: (input: { accelerator: string }) => Promise<GlobalShortcutState>
    saveSession: (input: { session: SessionState }) => Promise<void>
    addRecentRepo: (input: { repoPath: string }) => Promise<string[]>
    clearRecentRepos: () => Promise<void>
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
const CwdInput = v.object({ cwd: v.string() })
const PathInput = v.object({ path: v.string() })
const BranchInput = v.object({ cwd: v.string(), branch: v.string() })

export function createAppRouter(handlers: AppRpcHandlers) {
  return t.router({
    app: t.router({
      openProjectGitHub: p.input(EmptyInput).mutation(() => handlers.app.openProjectGitHub()),
    }),
    repo: t.router({
      openDialog: p.input(EmptyInput).query(() => handlers.repo.openDialog()),
      probe: p.input(CwdInput).query(({ input }) => handlers.repo.probe(input)),
      snapshot: p.input(CwdInput).query(({ input }) => handlers.repo.snapshot(input)),
      pullRequests: p
        .input(
          v.object({
            cwd: v.string(),
            branches: v.optional(v.array(v.string())),
            options: v.optional(
              v.object({
                mode: v.optional(v.picklist(['summary', 'full'])),
                silent: v.optional(v.boolean()),
                clearMissing: v.optional(v.boolean()),
              }),
            ),
          }),
        )
        .query(({ input }) => handlers.repo.pullRequests(input)),
      log: p
        .input(v.object({ cwd: v.string(), branch: v.string(), count: v.optional(FiniteNumber) }))
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
        .input(v.object({ cwd: v.string(), branch: v.string(), force: v.optional(v.boolean()) }))
        .mutation(({ input }) => handlers.repo.deleteBranch(input)),
      removeWorktree: p
        .input(
          v.object({
            cwd: v.string(),
            branch: v.string(),
            worktreePath: v.string(),
            alsoDeleteBranch: v.boolean(),
            forceDeleteBranch: v.optional(v.boolean()),
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
      openGitHub: p
        .input(v.object({ cwd: v.string(), branch: v.optional(v.string()) }))
        .mutation(({ input }) => handlers.repo.openGitHub(input)),
      openInFinder: p.input(PathInput).mutation(({ input }) => handlers.repo.openInFinder(input)),
      openInGhostty: p.input(PathInput).mutation(({ input }) => handlers.repo.openInGhostty(input)),
      openInVSCode: p.input(PathInput).mutation(({ input }) => handlers.repo.openInVSCode(input)),
      ghosttyInstalled: p.input(EmptyInput).query(() => handlers.repo.ghosttyInstalled()),
      vscodeInstalled: p.input(EmptyInput).query(() => handlers.repo.vscodeInstalled()),
    }),
    theme: t.router({
      get: p.input(EmptyInput).query(() => handlers.theme.get()),
      setPref: p
        .input(v.object({ pref: v.picklist(['auto', 'light', 'dark']) }))
        .mutation(({ input }) => handlers.theme.setPref(input)),
    }),
    settings: t.router({
      get: p.input(EmptyInput).query(() => handlers.settings.get()),
      setFetchInterval: p
        .input(v.object({ sec: FiniteNumber }))
        .mutation(({ input }) => handlers.settings.setFetchInterval(input)),
      setShortcutsDisabled: p
        .input(v.object({ disabled: v.boolean() }))
        .mutation(({ input }) => handlers.settings.setShortcutsDisabled(input)),
      setGlobalShortcut: p
        .input(v.object({ accelerator: v.string() }))
        .mutation(({ input }) => handlers.settings.setGlobalShortcut(input)),
      saveSession: p
        .input(
          v.object({
            session: v.object({
              openRepos: v.array(v.string()),
              activeRepo: v.nullable(v.string()),
              detailCollapsed: v.boolean(),
            }),
          }),
        )
        .mutation(({ input }) => handlers.settings.saveSession(input)),
      addRecentRepo: p
        .input(v.object({ repoPath: v.string() }))
        .mutation(({ input }) => handlers.settings.addRecentRepo(input)),
      clearRecentRepos: p.input(EmptyInput).mutation(() => handlers.settings.clearRecentRepos()),
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
