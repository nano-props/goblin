import {
  currentRuntimeSettingsSnapshot,
  readRuntimeFetchSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { runSettingsControllerAction } from '#/web/settings-write-paths.ts'
import { setFetchIntervalPreference, setTerminalNotificationsEnabledPreference } from '#/web/settings-write-paths.ts'

export function getRuntimeFetchSettings() {
  return readRuntimeFetchSettings(currentRuntimeSettingsSnapshot())
}

export function useRuntimeFetchSettings() {
  return readRuntimeFetchSettings(useRuntimeSettingsSnapshot())
}

export function useFetchSettingsController() {
  return {
    async setFetchInterval(sec: number): Promise<void> {
      await runSettingsControllerAction('fetch interval update', async () => {
        await setFetchIntervalPreference(sec)
      })
    },
    async setTerminalNotificationsEnabled(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('terminal notifications update', async () => {
        await setTerminalNotificationsEnabledPreference(enabled)
      })
    },
  }
}
