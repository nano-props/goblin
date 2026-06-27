import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import {
  runSettingsAction,
  setGlobalShortcut,
  setGlobalShortcutDisabled,
  setShortcutsDisabled,
} from '#/web/settings-actions.ts'
import type { GlobalShortcutState } from '#/shared/api-types.ts'

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentRuntimeSettingsSnapshot())
}

export function useShortcutSettings() {
  return readRuntimeShortcutSettings(useRuntimeSettingsSnapshot())
}

export function useShortcutSettingsController() {
  return {
    async setShortcutsDisabled(disabled: boolean): Promise<void> {
      await runSettingsAction('shortcuts update', async () => {
        await setShortcutsDisabled(disabled)
      })
    },
    async setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
      await runSettingsAction('global shortcut disabled update', async () => {
        await setGlobalShortcutDisabled(disabled)
      })
    },
    async setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState | null> {
      return await runSettingsAction('global shortcut update', async () => await setGlobalShortcut(accelerator))
    },
  }
}
