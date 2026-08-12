import { computed } from 'vue'
import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings-read-projection.ts'
import { setGlobalShortcut, setGlobalShortcutDisabled, setShortcutsDisabled } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'
import type { SetGlobalShortcutResult } from '#/shared/api-types.ts'

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentRuntimeSettingsSnapshot())
}

export function useShortcutSettings() {
  const snapshot = useRuntimeSettingsSnapshot()
  return computed(() => readRuntimeShortcutSettings(snapshot.value))
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
    setShortcutsDisabled(disabled: boolean): void {
      shortcutsDisabledMutation.mutate(disabled)
    },
    setGlobalShortcutDisabled(disabled: boolean): void {
      globalShortcutDisabledMutation.mutate(disabled)
    },
    setGlobalShortcut(accelerator: string, onSuccess: (result: SetGlobalShortcutResult) => void): void {
      globalShortcutMutation.mutate(accelerator, { onSuccess: (result) => onSuccess(result) })
    },
    globalShortcutPending: globalShortcutMutation.isPending,
  }
}
