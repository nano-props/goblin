import { probeExternalApps } from '#/system/external-apps.ts'
import type { ExternalAppsSnapshot } from '#/shared/rpc.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'

export async function getServerExternalAppsSnapshot(signal?: AbortSignal): Promise<ExternalAppsSnapshot> {
  const prefs = await getServerSettingsPrefs()
  const state = await probeExternalApps(prefs.terminalApp, prefs.editorApp, signal)
  return { terminal: state.terminals, editor: state.editors }
}
