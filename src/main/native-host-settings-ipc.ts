import type { NativeHostSettingsIpcHandlers } from '#/shared/api-types.ts'
import { parseAllowedGlobalShortcut } from '#/shared/accelerator.ts'
import { updateUserSettings } from '#/main/settings-server-client.ts'
import { refreshNativeSettingsProjection } from '#/main/native-settings-projection-sync.ts'
import { isGlobalShortcutRegistered } from '#/main/shortcuts.ts'
import { windowNodeLog } from '#/node/logger.ts'

export function createNativeHostSettingsIpcHandlers(): NativeHostSettingsIpcHandlers {
  return {
    settings: {
      setGlobalShortcut: async ({ accelerator }) => {
        const parsed = parseAllowedGlobalShortcut(accelerator)
        if (!parsed) throw new TypeError('invalid global shortcut')
        await updateUserSettings({ globalShortcut: parsed })
        try {
          const authoritative = await refreshNativeSettingsProjection()
          return {
            kind: 'projected',
            accelerator: authoritative.globalShortcut,
            registered: isGlobalShortcutRegistered(),
          }
        } catch (error) {
          windowNodeLog.warn({ err: error }, 'global shortcut preference committed but native projection failed')
          return { kind: 'committed-projection-failed' }
        }
      },
    },
  }
}
