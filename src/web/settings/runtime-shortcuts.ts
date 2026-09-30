import { computed } from 'vue'
import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/settings/read-projection.ts'
import { setShortcutsDisabled } from '#/web/settings/actions.ts'
import { useSettingsMutation } from '#/web/settings/mutations.ts'

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
  return {
    setShortcutsDisabled(disabled: boolean): void {
      shortcutsDisabledMutation.mutate(disabled)
    },
  }
}
