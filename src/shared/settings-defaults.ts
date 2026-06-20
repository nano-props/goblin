import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'
import { DEFAULT_COLOR_THEME, type ColorTheme } from '#/shared/color-theme.ts'
import type {
  EditorPref,
  LangPref,
  SessionState,
  SettingsPrefs,
  SettingsSnapshot,
  TerminalPref,
  ThemePref,
} from '#/shared/api-types.ts'
import {
  DEFAULT_WORKSPACE_FOCUSED,
  DEFAULT_WORKSPACE_PANE_SIZES,
} from '#/shared/workspace-layout.ts'

export const DEFAULT_FETCH_INTERVAL_SEC = 120
export const MAX_RECENT_REPOS = 10
export const DEFAULT_LANG_PREF: LangPref = 'auto'
export const DEFAULT_THEME_PREF: ThemePref = 'auto'
export const DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED = false
export const DEFAULT_SHORTCUTS_DISABLED = false
export const DEFAULT_GLOBAL_SHORTCUT_DISABLED = false
export const DEFAULT_SWAP_CLOSE_SHORTCUTS = false
export const DEFAULT_TERMINAL_APP: TerminalPref = 'auto'
export const DEFAULT_EDITOR_APP: EditorPref = 'auto'
export const DEFAULT_LAN_ENABLED = false

export function defaultSessionState(): SessionState {
  return {
    openRepos: [],
    activeRepo: null,
    workspaceFocused: DEFAULT_WORKSPACE_FOCUSED,
    workspacePaneSizes: { ...DEFAULT_WORKSPACE_PANE_SIZES },
    selectedTerminalByWorktree: {},
  }
}

export function defaultSettingsPrefs(overrides: Partial<SettingsPrefs> = {}): SettingsPrefs {
  return {
    lang: overrides.lang ?? DEFAULT_LANG_PREF,
    theme: overrides.theme ?? DEFAULT_THEME_PREF,
    colorTheme: overrides.colorTheme ?? DEFAULT_COLOR_THEME,
    fetchIntervalSec: overrides.fetchIntervalSec ?? DEFAULT_FETCH_INTERVAL_SEC,
    terminalNotificationsEnabled: overrides.terminalNotificationsEnabled ?? DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED,
    shortcutsDisabled: overrides.shortcutsDisabled ?? DEFAULT_SHORTCUTS_DISABLED,
    globalShortcutDisabled: overrides.globalShortcutDisabled ?? DEFAULT_GLOBAL_SHORTCUT_DISABLED,
    swapCloseShortcuts: overrides.swapCloseShortcuts ?? DEFAULT_SWAP_CLOSE_SHORTCUTS,
    globalShortcut: overrides.globalShortcut ?? DEFAULT_GLOBAL_SHORTCUT,
    terminalApp: overrides.terminalApp ?? DEFAULT_TERMINAL_APP,
    editorApp: overrides.editorApp ?? DEFAULT_EDITOR_APP,
    lanEnabled: overrides.lanEnabled ?? DEFAULT_LAN_ENABLED,
  }
}

export function defaultSettingsSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  const prefs = defaultSettingsPrefs(overrides)
  return {
    ...prefs,
    globalShortcutRegistered: overrides.globalShortcutRegistered ?? false,
    session: overrides.session ?? defaultSessionState(),
    recentRepos: overrides.recentRepos ?? [],
  }
}

export { DEFAULT_COLOR_THEME, DEFAULT_GLOBAL_SHORTCUT }
export type { ColorTheme }
