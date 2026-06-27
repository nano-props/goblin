import type { NativeHostIpcHandlers } from '#/shared/api-types.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { getUserSettings, setGlobalShortcutState, updateUserSettings } from '#/main/settings-server-client.ts'
import { applyNativeHostProjection } from '#/main/native-host-settings-effects.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut } from '#/main/shortcuts.ts'

// Native-host settings IPC handlers: read/write server-owned settings, then
// apply the corresponding Electron-only effects when needed.
function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}

async function getRuntimeUserSettings() {
  return await getUserSettings()
}

export function createNativeHostSettingsIpcHandlers(): Pick<NativeHostIpcHandlers, 'settings'> {
  return {
    settings: {
      applyNativeHostProjection: async (input) => await applyNativeHostProjection(input),
      setGlobalShortcut: async ({ accelerator }) => {
        const parsed = parseGlobalShortcut(accelerator)
        const serverSettings = await getRuntimeUserSettings()
        const currentGlobalShortcut = serverSettings.globalShortcut
        const currentGlobalShortcutDisabled = serverSettings.globalShortcutDisabled
        if (!parsed) return globalShortcutPayload(currentGlobalShortcut)
        if (isReservedGlobalShortcut(parsed)) return globalShortcutPayload(currentGlobalShortcut)
        const registered = currentGlobalShortcutDisabled || replaceGlobalShortcut(false, currentGlobalShortcut, parsed)
        if (!registered && !currentGlobalShortcutDisabled) return globalShortcutPayload(currentGlobalShortcut)
        const saved = (await updateUserSettings({ globalShortcut: parsed })).globalShortcut
        const payload = globalShortcutPayload(saved)
        await setGlobalShortcutState(payload.registered)
        return payload
      },
    },
  }
}
