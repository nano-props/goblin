import {
  getServerRecentRepos,
  getServerSessionState,
  getServerSettingsPrefs,
} from '#/server/modules/settings-source.ts'
import type { ServerSettingsState } from '#/server/modules/settings-state.ts'
import { buildSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import type { SettingsSnapshot } from '#/shared/rpc.ts'

export async function getSettingsSnapshot(state: ServerSettingsState): Promise<SettingsSnapshot> {
  const serverSettings = await getServerSettingsPrefs()
  return buildSettingsSnapshot({
    prefs: serverSettings,
    globalShortcutRegistered: state.globalShortcutRegistered,
    session: await getServerSessionState(),
    recentRepos: await getServerRecentRepos(),
  })
}
