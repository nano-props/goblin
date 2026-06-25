import type { ColorTheme } from '#/shared/color-theme.ts'

export type ThemePref = 'auto' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export type LangPref = 'auto' | 'en' | 'zh' | 'ko' | 'ja'
export type Lang = 'en' | 'zh' | 'ko' | 'ja'
export type TerminalApp = 'ghostty' | 'terminal' | 'windowsTerminal'
export type EditorApp = 'vscode' | 'cursor' | 'windsurf'
export type TerminalAppAvailability = Record<TerminalApp, boolean>
export type EditorAppAvailability = Record<EditorApp, boolean>

export interface SettingsPrefs {
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
