import {
  currentRuntimeSettingsSnapshot,
  readRuntimeFetchSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { setFetchInterval, setTerminalNotificationsEnabled } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'

export function getRuntimeFetchSettings() {
  return readRuntimeFetchSettings(currentRuntimeSettingsSnapshot())
}

export function useFetchSettings() {
  return readRuntimeFetchSettings(useRuntimeSettingsSnapshot())
}

export function useFetchSettingsController() {
  const fetchIntervalMutation = useSettingsMutation('fetch interval update', async (sec: number) => {
    await setFetchInterval(sec)
  })
  const terminalNotificationsMutation = useSettingsMutation(
    'terminal notifications update',
    async (enabled: boolean) => {
      await setTerminalNotificationsEnabled(enabled)
    },
  )
  return {
    async setFetchInterval(sec: number): Promise<void> {
      await fetchIntervalMutation.mutateAsync(sec)
    },
    async setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
      await terminalNotificationsMutation.mutateAsync(enabled)
    },
  }
}
