import { useSetFetchIntervalMutation, useSetTerminalNotificationsEnabledMutation } from '#/web/settings-queries.ts'
import { currentRuntimeSettingsSnapshot, readRuntimeFetchSettings, useRuntimeSettingsSnapshot } from '#/web/runtime-settings-snapshot.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'

export function getRuntimeFetchSettings() {
  return readRuntimeFetchSettings(currentRuntimeSettingsSnapshot())
}

export function useRuntimeFetchSettings() {
  return readRuntimeFetchSettings(useRuntimeSettingsSnapshot())
}

export function useFetchSettingsController() {
  const setFetchInterval = useSetFetchIntervalMutation()
  const setTerminalNotificationsEnabled = useSetTerminalNotificationsEnabledMutation()
  return {
    async setFetchInterval(sec: number): Promise<void> {
      await runSettingsControllerAction('fetch interval update', async () => {
        await setFetchInterval.mutateAsync(sec)
      })
    },
    async setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('terminal notifications update', async () => {
        await setTerminalNotificationsEnabled.mutateAsync(enabled)
      })
    },
  }
}
