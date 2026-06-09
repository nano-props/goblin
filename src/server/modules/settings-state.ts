export interface ServerSettingsState {
  globalShortcutRegistered: boolean
}

export function createServerSettingsState(): ServerSettingsState {
  return { globalShortcutRegistered: false }
}
