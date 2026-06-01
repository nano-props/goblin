import type { EditorPref, Lang, LangPref, TerminalPref } from '#/shared/rpc.ts'

export interface InitialSettingsSnapshot {
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
}

export interface InitialI18nSnapshot {
  lang: Lang
  pref: LangPref
  dict: Record<string, string>
}

export interface RendererBootstrapPayload {
  homeDir: string
  i18n: InitialI18nSnapshot
  settings: InitialSettingsSnapshot
}

export interface RendererBootstrapSnapshot {
  homeDir: string
  initialI18n: InitialI18nSnapshot | null
  initialSettings: InitialSettingsSnapshot | null
}
