import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import { readRuntimeLanSettings, useRuntimeSettingsSnapshot } from '#/web/runtime-settings-snapshot.ts'
import { setLanEnabledPreference } from '#/web/settings-write-paths.ts'

export function useRuntimeLanSettings() {
  return readRuntimeLanSettings(useRuntimeSettingsSnapshot())
}

export function useLanSettingsController() {
  return {
    async setLanEnabled(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('lanEnabled update', async () => {
        await setLanEnabledPreference(enabled)
      })
    },
  }
}
