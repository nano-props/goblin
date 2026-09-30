import { DEFAULT_COLOR_THEME } from '#/shared/color-theme.ts'
import type { ClientWorkspaceState, ServerWorkspaceState, SettingsSnapshot } from '#/shared/api-types.ts'
import type { LangPref, UserSettings, ThemePref } from '#/shared/settings.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'

export const DEFAULT_FETCH_INTERVAL_SEC = 120
export const MAX_RECENT_WORKSPACES = 10
export const DEFAULT_LANG_PREF: LangPref = 'auto'
export const DEFAULT_THEME_PREF: ThemePref = 'auto'
export const DEFAULT_TERMINAL_NOTIFICATIONS_ENABLED = false
export const DEFAULT_SHORTCUTS_DISABLED = false

export function defaultServerWorkspaceState(): ServerWorkspaceState {
  return { openWorkspaceEntries: [], workspacePaneTabsByTargetByWorkspace: {} }
}

export function defaultClientWorkspaceState(): ClientWorkspaceState {
  return {
    restoredWorkspaceId: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalFilesystemTarget: {},
    branchViewModeByWorkspace: {},
    preferredWorkspacePaneTabByTargetByWorkspace: {},
    filetreeViewStateByFilesystemTargetByWorkspace: {},
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
  }
}

export function defaultSettingsSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  const prefs = defaultUserSettings(overrides)
  return {
    ...prefs,
    recentWorkspaces: overrides.recentWorkspaces ?? [],
    workspaceSettings: overrides.workspaceSettings ?? [],
  }
}
