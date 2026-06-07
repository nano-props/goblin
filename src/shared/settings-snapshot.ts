import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { SessionState, SettingsPrefs, SettingsSnapshot } from '#/shared/rpc.ts'

export function buildSettingsSnapshot(input: {
  prefs: Omit<SettingsPrefs, 'lang'>
  globalShortcutRegistered: boolean
  session: SessionState
  recentRepos: RepoSessionEntry[]
}): SettingsSnapshot {
  return {
    theme: input.prefs.theme,
    colorTheme: input.prefs.colorTheme,
    fetchIntervalSec: input.prefs.fetchIntervalSec,
    terminalNotificationsEnabled: input.prefs.terminalNotificationsEnabled,
    shortcutsDisabled: input.prefs.shortcutsDisabled,
    globalShortcutDisabled: input.prefs.globalShortcutDisabled,
    swapCloseShortcuts: input.prefs.swapCloseShortcuts,
    toggleDetailOnActionBarBlankClick: input.prefs.toggleDetailOnActionBarBlankClick,
    globalShortcut: input.prefs.globalShortcut,
    globalShortcutRegistered: input.globalShortcutRegistered,
    terminalApp: input.prefs.terminalApp,
    editorApp: input.prefs.editorApp,
    lanEnabled: input.prefs.lanEnabled,
    session: input.session,
    recentRepos: input.recentRepos,
  }
}
