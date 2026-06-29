import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { setGlobalShortcut, setGlobalShortcutDisabled, setShortcutsDisabled } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'
import type { GlobalShortcutState } from '#/shared/api-types.ts'

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentRuntimeSettingsSnapshot())
}

export function useShortcutSettings() {
  return readRuntimeShortcutSettings(useRuntimeSettingsSnapshot())
}

export function useShortcutSettingsController() {
  const shortcutsDisabledMutation = useSettingsMutation('shortcuts update', async (disabled: boolean) => {
    await setShortcutsDisabled(disabled)
  })
  const globalShortcutDisabledMutation = useSettingsMutation(
    'global shortcut disabled update',
    async (disabled: boolean) => {
      await setGlobalShortcutDisabled(disabled)
    },
  )
  const globalShortcutMutation = useSettingsMutation(
    'global shortcut update',
    async (accelerator: string) => await setGlobalShortcut(accelerator),
  )
  return {
    async setShortcutsDisabled(disabled: boolean): Promise<void> {
      await shortcutsDisabledMutation.mutateAsync(disabled)
    },
    async setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
      await globalShortcutDisabledMutation.mutateAsync(disabled)
    },
    async setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState | null> {
      return await globalShortcutMutation.mutateAsync(accelerator)
    },
  }
}
