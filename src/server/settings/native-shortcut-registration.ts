export interface NativeShortcutRegistrationState {
  globalShortcutRegistered: boolean
}

export function createNativeShortcutRegistrationState(): NativeShortcutRegistrationState {
  return { globalShortcutRegistered: false }
}
