import { probeExternalApps } from '#/system/external-apps.ts'
import type { ExternalAppsSnapshot, SettingsPrefs } from '#/shared/api-types.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'

export async function buildServerExternalAppsSnapshot(
  settings: Pick<SettingsPrefs, 'terminalApp' | 'editorApp'>,
  signal?: AbortSignal,
): Promise<ExternalAppsSnapshot> {
  const state = await probeExternalApps(settings.terminalApp, settings.editorApp, signal)
  return { terminal: state.terminals, editor: state.editors }
}

export async function getServerExternalAppsSnapshot(signal?: AbortSignal): Promise<ExternalAppsSnapshot> {
  return await buildServerExternalAppsSnapshot(await getServerSettingsPrefs(), signal)
}
