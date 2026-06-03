import type { AppRpcHandlers } from '#/shared/rpc.ts'
import { getSettingsPrefs } from '#/main/settings-server-facade.ts'
import { getExternalAppsState, refreshExternalAppsState } from '#/main/settings-native-probes.ts'

async function getRuntimeServerSettingsPrefs() {
  return await getSettingsPrefs()
}

export function createExternalAppsNativeRpcHandlers(options: {
  currentRpcSignal: () => AbortSignal | undefined
}): Pick<AppRpcHandlers, 'externalApps'> {
  return {
    externalApps: {
      get: async () => {
        const serverSettings = await getRuntimeServerSettingsPrefs()
        return getExternalAppsState(serverSettings.terminalApp, serverSettings.editorApp, options.currentRpcSignal())
      },
      refresh: async () => {
        const serverSettings = await getRuntimeServerSettingsPrefs()
        return refreshExternalAppsState(
          serverSettings.terminalApp,
          serverSettings.editorApp,
          options.currentRpcSignal(),
        )
      },
    },
  }
}
