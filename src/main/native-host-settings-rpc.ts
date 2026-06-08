import type { NativeRpcHandlers } from '#/shared/rpc.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { getSettingsPrefs, updateSettingsPrefs } from '#/main/settings-server-client.ts'
import { applyNativeHostShellProjection, broadcastNativeHostGlobalShortcutState } from '#/main/native-host-settings-effects.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut } from '#/main/shortcuts.ts'

// Native-host settings RPC handlers: read/write server-owned settings, then
// apply the corresponding Electron-only effects when needed.
function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}

async function getRuntimeServerSettingsPrefs() {
  return await getSettingsPrefs()
}

export function createNativeHostSettingsRpcHandlers(options: {
  addRecentDocument: (path: string) => void
  clearRecentDocuments: () => void
}): Pick<NativeRpcHandlers, 'settings'> {
  return {
    settings: {
      applyShellProjection: async (input) => await applyNativeHostShellProjection(input, { addRecentDocument: options.addRecentDocument }),
      clearNativeRecentDocuments: async () => {
        options.clearRecentDocuments()
      },
      setGlobalShortcut: async ({ accelerator }) => {
        const parsed = parseGlobalShortcut(accelerator)
        const serverSettings = await getRuntimeServerSettingsPrefs()
        const currentGlobalShortcut = serverSettings.globalShortcut
        const currentGlobalShortcutDisabled = serverSettings.globalShortcutDisabled
        if (!parsed) return globalShortcutPayload(currentGlobalShortcut)
        if (isReservedGlobalShortcut(parsed)) return globalShortcutPayload(currentGlobalShortcut)
        const registered = currentGlobalShortcutDisabled || replaceGlobalShortcut(false, currentGlobalShortcut, parsed)
        if (!registered && !currentGlobalShortcutDisabled) return globalShortcutPayload(currentGlobalShortcut)
        const saved = (await updateSettingsPrefs({ globalShortcut: parsed })).globalShortcut
        const payload = globalShortcutPayload(saved)
        await broadcastNativeHostGlobalShortcutState(payload.accelerator, payload.registered)
        return payload
      },
    },
  }
}
