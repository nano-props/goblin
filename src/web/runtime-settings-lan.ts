import { readRuntimeLanSettings, useRuntimeSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { setLanEnabled } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'

export function useLanSettings() {
  return readRuntimeLanSettings(useRuntimeSettingsSnapshot())
}

export function useLanSettingsController() {
  const lanEnabledMutation = useSettingsMutation('lanEnabled update', async (enabled: boolean) => {
    await setLanEnabled(enabled)
  })
  return {
    async setLanEnabled(enabled: boolean): Promise<void> {
      await lanEnabledMutation.mutateAsync(enabled)
    },
  }
}
