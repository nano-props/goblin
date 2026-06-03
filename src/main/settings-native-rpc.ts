import { RpcError, type AppRpcHandlers } from '#/shared/rpc.ts'
import { isReservedGlobalShortcut, parseGlobalShortcut } from '#/shared/accelerator.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/settings-defaults.ts'
import { probeEditorApps, probeTerminalApps } from '#/system/external-apps.ts'
import {
  getSettingsPrefs,
  getSettingsSnapshot,
  setSettingsFetchInterval,
  updateSettingsPrefs,
} from '#/main/settings-server-facade.ts'
import {
  applyEditorAppEffects,
  applyFetchIntervalEffects,
  applyGlobalShortcutDisabledEffects,
  applyGlobalShortcutEffects,
  applyShortcutsDisabledEffects,
  applySwapCloseShortcutsEffects,
  applyTerminalAppEffects,
  applyTerminalNotificationsEnabledEffects,
  applyToggleDetailOnActionBarBlankClickEffects,
} from '#/main/settings-native-effects.ts'
import { isGlobalShortcutRegistered, replaceGlobalShortcut } from '#/main/shortcuts.ts'
import {
  addRecentRepoAndApplyEffects,
  clearRecentReposAndApplyEffects,
  persistSettingsSession,
} from '#/main/settings-native-session.ts'

function globalShortcutPayload(accelerator: string): { accelerator: string; registered: boolean } {
  return { accelerator, registered: isGlobalShortcutRegistered() }
}

async function getRuntimeServerSettingsPrefs() {
  return await getSettingsPrefs()
}

export function createSettingsNativeRpcHandlers(options: {
  currentRpcSignal: () => AbortSignal | undefined
  addRecentDocument: (path: string) => void
}): Pick<AppRpcHandlers, 'settings'> {
  return {
    settings: {
      get: async () => await getSettingsSnapshot(),
      setFetchInterval: async ({ sec }) => {
        if (!Number.isFinite(sec)) throw new RpcError({ code: 'BAD_REQUEST', message: 'Invalid fetch interval' })
        const next = await setSettingsFetchInterval(sec)
        applyFetchIntervalEffects(next)
      },
      setTerminalNotificationsEnabled: async ({ enabled }) => {
        if (typeof enabled !== 'boolean') return
        const serverSettings = await updateSettingsPrefs({ terminalNotificationsEnabled: enabled })
        applyTerminalNotificationsEnabledEffects(serverSettings.terminalNotificationsEnabled)
      },
      setShortcutsDisabled: async ({ disabled }) => {
        if (typeof disabled !== 'boolean') return
        const serverSettings = await updateSettingsPrefs({ shortcutsDisabled: disabled })
        applyShortcutsDisabledEffects(serverSettings.shortcutsDisabled)
      },
      setGlobalShortcutDisabled: async ({ disabled }) => {
        if (typeof disabled !== 'boolean') return
        const serverSettings = await updateSettingsPrefs({ globalShortcutDisabled: disabled })
        await applyGlobalShortcutDisabledEffects(
          serverSettings.globalShortcutDisabled,
          serverSettings.globalShortcut ?? DEFAULT_GLOBAL_SHORTCUT,
        )
      },
      setSwapCloseShortcuts: async ({ swapped }) => {
        if (typeof swapped !== 'boolean') return
        const serverSettings = await updateSettingsPrefs({ swapCloseShortcuts: swapped })
        applySwapCloseShortcutsEffects(serverSettings.swapCloseShortcuts)
      },
      setToggleDetailOnActionBarBlankClick: async ({ enabled }) => {
        if (typeof enabled !== 'boolean') return
        const serverSettings = await updateSettingsPrefs({ toggleDetailOnActionBarBlankClick: enabled })
        applyToggleDetailOnActionBarBlankClickEffects(serverSettings.toggleDetailOnActionBarBlankClick)
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
        await applyGlobalShortcutEffects(payload.accelerator, payload.registered)
        return payload
      },
      setTerminalApp: async ({ pref }) => {
        const serverSettings = await updateSettingsPrefs({ terminalApp: pref })
        const payload = await probeTerminalApps(serverSettings.terminalApp, options.currentRpcSignal())
        applyTerminalAppEffects(payload)
        return payload
      },
      setEditorApp: async ({ pref }) => {
        const serverSettings = await updateSettingsPrefs({ editorApp: pref })
        const payload = probeEditorApps(serverSettings.editorApp)
        applyEditorAppEffects(payload)
        return payload
      },
      saveSession: async ({ session }) => persistSettingsSession(session),
      addRecentRepo: async ({ repo }) =>
        addRecentRepoAndApplyEffects(repo, { addRecentDocument: options.addRecentDocument }),
      clearRecentRepos: async () => clearRecentReposAndApplyEffects(),
    },
  }
}
