import type { ColorTheme } from '#/shared/color-theme.ts'

export const THEME_PREF_VALUES = ['auto', 'light', 'dark'] as const
export const LANG_VALUES = ['en', 'zh', 'ko', 'ja'] as const
export const LANG_PREF_VALUES = ['auto', ...LANG_VALUES] as const
export const TERMINAL_APP_VALUES = ['ghostty', 'terminal', 'windowsTerminal'] as const
export const EDITOR_APP_VALUES = ['vscode'] as const

export type ThemePref = (typeof THEME_PREF_VALUES)[number]
export type ResolvedTheme = 'light' | 'dark'
export type LangPref = (typeof LANG_PREF_VALUES)[number]
export type Lang = (typeof LANG_VALUES)[number]
export type TerminalApp = (typeof TERMINAL_APP_VALUES)[number]
export type EditorApp = (typeof EDITOR_APP_VALUES)[number]
export type TerminalAppAvailability = Record<TerminalApp, boolean>
export type EditorAppAvailability = Record<EditorApp, boolean>

export interface UserSettings {
  theme: ThemePref
  colorTheme: ColorTheme
  lang: LangPref
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  globalShortcut: string
  lanEnabled: boolean
}
