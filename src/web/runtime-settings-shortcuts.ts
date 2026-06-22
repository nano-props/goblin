import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { runSettingsControllerAction } from '#/web/settings-write-paths.ts'
import {
  setGlobalShortcutDisabledPreference,
  setGlobalShortcutPreference,
  setShortcutsDisabledPreference,
} from '#/web/settings-write-paths.ts'
import type { GlobalShortcutState } from '#/shared/api-types.ts'

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentRuntimeSettingsSnapshot())
}

export function useRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(useRuntimeSettingsSnapshot())
}

export function useShortcutSettingsController() {
  return {
    async setShortcutsDisabled(disabled: boolean): Promise<void> {
      await runSettingsControllerAction('shortcuts update', async () => {
        await setShortcutsDisabledPreference(disabled)
      })
    },
    async setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
      await runSettingsControllerAction('global shortcut disabled update', async () => {
        await setGlobalShortcutDisabledPreference(disabled)
      })
    },
    async setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState | null> {
      return await runSettingsControllerAction(
        'global shortcut update',
        async () => await setGlobalShortcutPreference(accelerator),
      )
    },
  }
}
