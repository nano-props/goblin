import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type {
  RuntimeRecentReposState,
  RuntimeSettingsSnapshot,
  SessionState,
  SettingsPrefs,
  SettingsSnapshot,
} from '#/shared/api-types.ts'

export function buildRuntimeSettingsSnapshot(input: {
  prefs: SettingsPrefs
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
  prefs: SettingsPrefs
  globalShortcutRegistered: boolean
  session: SessionState
  recentRepos: RepoSessionEntry[]
}): SettingsSnapshot {
  return {
    ...buildRuntimeSettingsSnapshot({
      prefs: input.prefs,
      globalShortcutRegistered: input.globalShortcutRegistered,
    }),
    ...buildRuntimeRecentReposState({ recentRepos: input.recentRepos }),
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

export function restorableSessionStateFromSettingsSnapshot(snapshot: Pick<SettingsSnapshot, 'session'>): SessionState {
  return snapshot.session
}
