import type { ColorTheme } from '#/shared/color-theme.ts'

export const THEME_PREF_VALUES = ['auto', 'light', 'dark'] as const
export const LANG_PREF_VALUES = ['auto', 'en', 'zh', 'ko', 'ja'] as const

export type ThemePref = (typeof THEME_PREF_VALUES)[number]
export type ResolvedTheme = 'light' | 'dark'
export type LangPref = (typeof LANG_PREF_VALUES)[number]
export type Lang = 'en' | 'zh' | 'ko' | 'ja'
export type TerminalApp = 'ghostty' | 'terminal' | 'windowsTerminal'
export type EditorApp = 'vscode'
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
