/// <reference types="vite/client" />

import type { BranchInfo, ExecResult, LogEntry, WorktreeStatus } from '#/renderer/types.ts'
import type {
  CommitDetail,
  I18nPayload,
  LangPref,
  MenuAction,
  SessionState,
  SettingsSnapshot,
  ThemePref,
  ThemeState,
} from '#/renderer/types-bridge.ts'

interface RepoSnapshot {
  branches: BranchInfo[]
  current: string
}

interface ProbeResult {
  ok: boolean
  root?: string
  name?: string
}

interface GblBridge {
  homeDir: string
  openDialog: () => Promise<string | null>
  openProjectGitHub: () => Promise<ExecResult>
  pathForFile: (file: File) => string
  probe: (cwd: string) => Promise<ProbeResult>
  snapshot: (cwd: string) => Promise<RepoSnapshot | null>
  log: (cwd: string, branch: string, count?: number) => Promise<LogEntry[]>
  status: (cwd: string) => Promise<WorktreeStatus[]>
  patch: (cwd: string, worktreePath: string) => Promise<ExecResult>
  commit: (cwd: string, hash: string) => Promise<CommitDetail | null>
  checkout: (cwd: string, branch: string) => Promise<ExecResult>
  deleteBranch: (cwd: string, branch: string) => Promise<ExecResult>
  removeWorktree: (cwd: string, branch: string, worktreePath: string, alsoDeleteBranch: boolean) => Promise<ExecResult>
  createWorktree: (cwd: string, worktreePath: string, newBranch: string, baseBranch: string) => Promise<ExecResult>
  pull: (cwd: string, branch: string, worktreePath?: string) => Promise<ExecResult>
  push: (cwd: string, branch: string) => Promise<ExecResult>
  fetch: (cwd: string, kind?: 'user' | 'background') => Promise<ExecResult>
  abort: (cwd: string) => Promise<boolean>
  openGitHub: (cwd: string, branch?: string) => Promise<ExecResult>
  openInFinder: (path: string) => Promise<ExecResult>
  openInGhostty: (path: string) => Promise<ExecResult>
  openInVSCode: (path: string) => Promise<ExecResult>
  ghosttyInstalled: () => Promise<boolean>
  vscodeInstalled: () => Promise<boolean>
  theme: {
    get: () => Promise<ThemeState>
    setPref: (pref: ThemePref) => Promise<ThemeState>
    onChange: (cb: (state: ThemeState) => void) => () => void
  }
  settings: {
    get: () => Promise<SettingsSnapshot>
    setFetchInterval: (sec: number) => Promise<void>
    onFetchIntervalChange: (cb: (sec: number) => void) => () => void
    saveSession: (session: SessionState) => Promise<void>
    onWriteError: (cb: (message: string) => void) => () => void
  }
  onMenuAction: (cb: (action: MenuAction) => void) => () => void
  i18n: {
    get: () => Promise<I18nPayload>
    setPref: (pref: LangPref) => Promise<I18nPayload | null>
    onChange: (cb: (payload: I18nPayload) => void) => () => void
  }
}

declare global {
  interface Window {
    gbl: GblBridge
  }
  /** Injected by vite.config.ts `define`. */
  const __APP_VERSION__: string
  /** Injected by vite.config.ts `define`. `commit` may be empty if the
   *  build host has no git available; SettingsPanel hides it then. */
  const __BUILD_INFO__: {
    commit: string
  }
}

export {}
