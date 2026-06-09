import { useSetLanEnabledMutation } from '#/web/settings-queries.ts'
import { readRuntimeLanSettings, useRuntimeSettingsSnapshot } from '#/web/runtime-settings-snapshot.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'

export function useRuntimeLanSettings() {
  return readRuntimeLanSettings(useRuntimeSettingsSnapshot())
}

export function useLanSettingsController() {
  const setLanEnabled = useSetLanEnabledMutation()
  return {
    async setLanEnabled(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('lanEnabled update', async () => {
        await setLanEnabled.mutateAsync(enabled)
      })
    },
  }
}
