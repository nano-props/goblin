import { getServerRecentWorkspaces, getServerWorkspaceSettings, getUserSettings } from '#/server/settings/source.ts'
import { buildSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import type { SettingsSnapshot } from '#/shared/api-types.ts'

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const serverSettings = await getUserSettings()
  return buildSettingsSnapshot({
    prefs: serverSettings,
    recentWorkspaces: await getServerRecentWorkspaces(),
    workspaceSettings: await getServerWorkspaceSettings(),
  })
}
