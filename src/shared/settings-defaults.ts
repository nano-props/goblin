import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'
import { DEFAULT_COLOR_THEME, type ColorTheme } from '#/shared/color-theme.ts'
import type {
  ClientWorkspaceState,
  LangPref,
  ServerWorkspaceState,
  UserSettings,
  SettingsSnapshot,
  ThemePref,
} from '#/shared/api-types.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'

export const DEFAULT_FETCH_INTERVAL_SEC = 120
export const MAX_RECENT_WORKSPACES = 10
export const DEFAULT_LANG_PREF: LangPref = 'auto'
export const DEFAULT_THEME_PREF: ThemePref = 'auto'
export const DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED = false
export const DEFAULT_SHORTCUTS_DISABLED = false
export const DEFAULT_GLOBAL_SHORTCUT_DISABLED = false
export const DEFAULT_LAN_ENABLED = false

export function defaultServerWorkspaceState(): ServerWorkspaceState {
  return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
}

export function defaultClientWorkspaceState(): ClientWorkspaceState {
  return {
    restoredWorkspaceId: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalFilesystemTarget: {},
    preferredWorkspacePaneTabByTargetByWorkspace: {},
    filetreeViewStateByWorktreeByWorkspace: {},
  }
}

export function defaultUserSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    lang: overrides.lang ?? DEFAULT_LANG_PREF,
    theme: overrides.theme ?? DEFAULT_THEME_PREF,
    colorTheme: overrides.colorTheme ?? DEFAULT_COLOR_THEME,
    fetchIntervalSec: overrides.fetchIntervalSec ?? DEFAULT_FETCH_INTERVAL_SEC,
    terminalNotificationsEnabled: overrides.terminalNotificationsEnabled ?? DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED,
    shortcutsDisabled: overrides.shortcutsDisabled ?? DEFAULT_SHORTCUTS_DISABLED,
    globalShortcutDisabled: overrides.globalShortcutDisabled ?? DEFAULT_GLOBAL_SHORTCUT_DISABLED,
    globalShortcut: overrides.globalShortcut ?? DEFAULT_GLOBAL_SHORTCUT,
    lanEnabled: overrides.lanEnabled ?? DEFAULT_LAN_ENABLED,
  }
}

export function defaultSettingsSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  const prefs = defaultUserSettings(overrides)
  return {
    ...prefs,
    globalShortcutRegistered: overrides.globalShortcutRegistered ?? false,
    recentWorkspaces: overrides.recentWorkspaces ?? [],
    workspaceSettings: overrides.workspaceSettings ?? [],
  }
}

export { DEFAULT_COLOR_THEME, DEFAULT_GLOBAL_SHORTCUT }
export type { ColorTheme }
