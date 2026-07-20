import {
  getServerRecentWorkspaces,
  getServerWorkspaceSettings,
  getUserSettings,
} from '#/server/modules/settings-source.ts'
import type { NativeShortcutRegistrationState } from '#/server/modules/native-shortcut-registration.ts'
import { buildSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import type { SettingsSnapshot } from '#/shared/api-types.ts'

export async function getSettingsSnapshot(state: NativeShortcutRegistrationState): Promise<SettingsSnapshot> {
  const serverSettings = await getUserSettings()
  return buildSettingsSnapshot({
    prefs: serverSettings,
    globalShortcutRegistered: state.globalShortcutRegistered,
    recentWorkspaces: await getServerRecentWorkspaces(),
    workspaceSettings: await getServerWorkspaceSettings(),
  })
}
