import {
  currentRuntimeSettingsSnapshot,
  readRuntimeFetchSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { runSettingsAction, setFetchInterval, setTerminalNotificationsEnabled } from '#/web/settings-actions.ts'

export function getRuntimeFetchSettings() {
  return readRuntimeFetchSettings(currentRuntimeSettingsSnapshot())
}

export function useFetchSettings() {
  return readRuntimeFetchSettings(useRuntimeSettingsSnapshot())
}

export function useFetchSettingsController() {
  return {
    async setFetchInterval(sec: number): Promise<void> {
      await runSettingsAction('fetch interval update', async () => {
        await setFetchInterval(sec)
      })
    },
    async setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
      await runSettingsAction('terminal notifications update', async () => {
        await setTerminalNotificationsEnabled(enabled)
      })
    },
  }
}
