import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { RepoSettingsEntry } from '#/shared/repo-settings.ts'
import type {
  RuntimeRecentReposState,
  RuntimeSettingsSnapshot,
  WorkspaceSessionState,
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

export function buildRuntimeRecentReposState(input: { recentRepos: RepoSessionEntry[] }): RuntimeRecentReposState {
  return {
    recentRepos: input.recentRepos,
  }
}

export function buildSettingsSnapshot(input: {
  prefs: UserSettings
  globalShortcutRegistered: boolean
  session: WorkspaceSessionState
  recentRepos: RepoSessionEntry[]
  repoSettings: RepoSettingsEntry[]
}): SettingsSnapshot {
  return {
    ...buildRuntimeSettingsSnapshot({
      prefs: input.prefs,
      globalShortcutRegistered: input.globalShortcutRegistered,
    }),
    ...buildRuntimeRecentReposState({ recentRepos: input.recentRepos }),
    repoSettings: input.repoSettings,
    session: input.session,
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

export function runtimeRecentReposStateFromSettingsSnapshot(
  snapshot: Pick<SettingsSnapshot, 'recentRepos'>,
): RuntimeRecentReposState {
  return {
    recentRepos: snapshot.recentRepos,
  }
}

export function restorableWorkspaceSessionStateFromSettingsSnapshot(
  snapshot: Pick<SettingsSnapshot, 'session'>,
): WorkspaceSessionState {
  return snapshot.session
}
