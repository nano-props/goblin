import { getServerRecentRepos, getServerSessionState, getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import { buildSettingsSnapshot } from '#/shared/settings-snapshot.ts'
import type { SettingsSnapshot } from '#/shared/rpc.ts'

let globalShortcutRegistered = false

export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const serverSettings = await getServerSettingsPrefs()
  return buildSettingsSnapshot({
    prefs: serverSettings,
    globalShortcutRegistered,
    session: await getServerSessionState(),
    recentRepos: await getServerRecentRepos(),
  })
}

export function setServerGlobalShortcutRegistered(registered: boolean): boolean {
  globalShortcutRegistered = registered === true
  return globalShortcutRegistered
}

export function resetServerSettingsRuntimeForTests(): void {
  globalShortcutRegistered = false
}
