import type { WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'
import type {
  RuntimeRecentWorkspacesState,
  RuntimeSettingsSnapshot,
  UserSettings,
  SettingsSnapshot,
} from '#/shared/api-types.ts'

export function buildRuntimeSettingsSnapshot(input: {
  prefs: UserSettings
  globalShortcutRegistered: boolean
}): RuntimeSettingsSnapshot {
  return {
    lang: input.prefs.lang,
    theme: input.prefs.theme,
    colorTheme: input.prefs.colorTheme,
    fetchIntervalSec: input.prefs.fetchIntervalSec,
    terminalNotificationsEnabled: input.prefs.terminalNotificationsEnabled,
    shortcutsDisabled: input.prefs.shortcutsDisabled,
    globalShortcutDisabled: input.prefs.globalShortcutDisabled,
    globalShortcut: input.prefs.globalShortcut,
    globalShortcutRegistered: input.globalShortcutRegistered,
    lanEnabled: input.prefs.lanEnabled,
  }
}

export function buildRuntimeRecentWorkspacesState(input: { recentWorkspaces: WorkspaceSessionEntry[] }): RuntimeRecentWorkspacesState {
  return {
    recentWorkspaces: input.recentWorkspaces,
  }
}

export function buildSettingsSnapshot(input: {
  prefs: UserSettings
  globalShortcutRegistered: boolean
  recentWorkspaces: WorkspaceSessionEntry[]
  repoSettings: RepoSettingsEntry[]
}): SettingsSnapshot {
  return {
    ...buildRuntimeSettingsSnapshot({
      prefs: input.prefs,
      globalShortcutRegistered: input.globalShortcutRegistered,
    }),
    ...buildRuntimeRecentWorkspacesState({ recentWorkspaces: input.recentWorkspaces }),
    repoSettings: input.repoSettings,
  }
}

export function runtimeSettingsSnapshotFromSettingsSnapshot(
  snapshot: Pick<
    SettingsSnapshot,
    | 'lang'
    | 'theme'
    | 'colorTheme'
    | 'fetchIntervalSec'
    | 'terminalNotificationsEnabled'
    | 'shortcutsDisabled'
    | 'globalShortcutDisabled'
    | 'globalShortcut'
    | 'globalShortcutRegistered'
    | 'lanEnabled'
  >,
): RuntimeSettingsSnapshot {
  return {
    lang: snapshot.lang,
    theme: snapshot.theme,
    colorTheme: snapshot.colorTheme,
    fetchIntervalSec: snapshot.fetchIntervalSec,
    terminalNotificationsEnabled: snapshot.terminalNotificationsEnabled,
    shortcutsDisabled: snapshot.shortcutsDisabled,
    globalShortcutDisabled: snapshot.globalShortcutDisabled,
    globalShortcut: snapshot.globalShortcut,
    globalShortcutRegistered: snapshot.globalShortcutRegistered,
    lanEnabled: snapshot.lanEnabled,
  }
}
