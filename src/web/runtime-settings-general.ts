import { readRuntimeGeneralSettings, useRuntimeSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { runSettingsControllerAction, setToggleDetailOnActionBarBlankClickPreference } from '#/web/settings-write-paths.ts'

export function useRuntimeGeneralSettings() {
  const runtimeSettings = useRuntimeSettingsSnapshot()
  return readRuntimeGeneralSettings(runtimeSettings)
}

export function useGeneralSettingsController() {
  return {
    async setToggleDetailOnActionBarBlankClick(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('action bar blank toggle update', async () => {
        await setToggleDetailOnActionBarBlankClickPreference(enabled)
      })
    },
  }
}
