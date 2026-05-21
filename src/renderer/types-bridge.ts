// Re-exports for store/component imports. Centralizes bridge types so
// stores don't need to redeclare them.

export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
}

export type LangPref = 'auto' | 'en' | 'zh' | 'ko' | 'ja'
export type Lang = 'en' | 'zh' | 'ko' | 'ja'

export interface I18nPayload {
  lang: Lang
  pref: LangPref
  dict: Record<string, string>
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
