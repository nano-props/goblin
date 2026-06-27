import { readRuntimeLanSettings, useRuntimeSettingsSnapshot } from '#/web/settings-read-projection.ts'
import { runSettingsAction, setLanEnabled } from '#/web/settings-actions.ts'

export function useLanSettings() {
  return readRuntimeLanSettings(useRuntimeSettingsSnapshot())
}

export function useLanSettingsController() {
  return {
    async setLanEnabled(enabled: boolean): Promise<void> {
      await runSettingsAction('lanEnabled update', async () => {
        await setLanEnabled(enabled)
      })
    },
  }
}
