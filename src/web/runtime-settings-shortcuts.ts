import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import {
  currentRuntimeSettingsSnapshot,
  readRuntimeShortcutSettings,
  useRuntimeSettingsSnapshot,
} from '#/web/runtime-settings-snapshot.ts'
import { useSetGlobalShortcutDisabledMutation, useSetGlobalShortcutMutation, useSetShortcutsDisabledMutation, useSetSwapCloseShortcutsMutation } from '#/web/settings-queries.ts'
import type { GlobalShortcutState } from '#/shared/rpc.ts'

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentRuntimeSettingsSnapshot())
}

export function useRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(useRuntimeSettingsSnapshot())
}

export function useShortcutSettingsController() {
  const setShortcutsDisabled = useSetShortcutsDisabledMutation()
  const setGlobalShortcutDisabled = useSetGlobalShortcutDisabledMutation()
  const setSwapCloseShortcuts = useSetSwapCloseShortcutsMutation()
  const setGlobalShortcut = useSetGlobalShortcutMutation()
  return {
    async setShortcutsDisabled(disabled: boolean): Promise<void> {
      await runSettingsControllerAction('shortcuts update', async () => {
        await setShortcutsDisabled.mutateAsync(disabled)
      })
    },
    async setGlobalShortcutDisabled(disabled: boolean): Promise<void> {
      await runSettingsControllerAction('global shortcut disabled update', async () => {
        await setGlobalShortcutDisabled.mutateAsync(disabled)
      })
    },
    async setSwapCloseShortcuts(swapped: boolean): Promise<void> {
      await runSettingsControllerAction('swap close shortcuts update', async () => {
        await setSwapCloseShortcuts.mutateAsync(swapped)
      })
    },
    async setGlobalShortcut(accelerator: string): Promise<GlobalShortcutState | null> {
      return await runSettingsControllerAction('global shortcut update', async () => await setGlobalShortcut.mutateAsync(accelerator))
    },
  }
}
