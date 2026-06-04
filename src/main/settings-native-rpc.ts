import type { NativeRpcHandlers } from '#/shared/rpc.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/settings-defaults.ts'
import {
  getSettingsPrefs,
  updateSettingsPrefs,
} from '#/main/settings-server-facade.ts'
import { applyGlobalShortcutEffects } from '#/main/settings-native-effects.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut } from '#/main/shortcuts.ts'
import {
  applyRecentReposProjection,
} from '#/main/settings-native-session.ts'

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}

async function getRuntimeServerSettingsPrefs() {
  return await getSettingsPrefs()
}

export function createSettingsNativeRpcHandlers(options: {
  addRecentDocument: (path: string) => void
}): Pick<NativeRpcHandlers, 'settings'> {
  return {
    settings: {
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
        await applyGlobalShortcutEffects(payload.accelerator, payload.registered)
        return payload
      },
      applyRecentReposProjection: async ({ recentRepos, addedRepo }) =>
        applyRecentReposProjection(recentRepos, { addedRepo, addRecentDocument: options.addRecentDocument }),
    },
  }
}
