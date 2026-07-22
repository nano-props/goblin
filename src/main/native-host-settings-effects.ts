import { resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import { syncRecentWorkspaces } from '#/main/recent-workspaces.ts'
import { setGlobalShortcutState } from '#/main/settings-server-client.ts'
import { syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { applyThemeSettingsProjection } from '#/main/theme.ts'
import type {
  NativeHostProjection,
  NativeSettingsProjectionPatch,
  NativeSettingsProjectionState,
} from '#/shared/api-types.ts'

// Native-host application of server-owned settings changes.
//
// Naming rule:
// - `broadcast*` = publish client-visible state that main has already resolved
//   or validated.
// - `apply*` = mutate native host chrome / menu / OS integration state.
//
// Keep this module narrow: only retain effects that are actually shared across
// multiple main-side call sites.
async function persistNativeHostGlobalShortcutState(registered: boolean): Promise<void> {
  await setGlobalShortcutState(registered)
}

function menuStatePatchFromSettingsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): {
  langPref?: NativeSettingsProjectionState['lang']
  shortcutsDisabled?: boolean
} {
  const menuStatePatch: {
    langPref?: NativeSettingsProjectionState['lang']
    shortcutsDisabled?: boolean
  } = {}
  if (input.patch.lang !== undefined) menuStatePatch.langPref = input.settings.lang
  if (input.patch.shortcutsDisabled !== undefined) menuStatePatch.shortcutsDisabled = input.settings.shortcutsDisabled
  return menuStatePatch
}

function shouldRebuildMenuFromSettingsProjection(patch: NativeSettingsProjectionPatch): boolean {
  return patch.lang !== undefined || patch.shortcutsDisabled !== undefined
}

function applyI18nProjectionPatch(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): void {
  if (input.patch.lang === undefined) return
  setCurrentLang(resolveLang(input.settings.lang))
}

function applyThemeProjectionPatch(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): void {
  if (input.patch.theme === undefined && input.patch.colorTheme === undefined) return
  applyThemeSettingsProjection({ theme: input.settings.theme, colorTheme: input.settings.colorTheme })
}

async function applyGlobalShortcutDisabledProjectionPatch(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): Promise<void> {
  if (input.patch.globalShortcutDisabled === undefined && input.patch.globalShortcut === undefined) return
  const registered = syncGlobalShortcuts(input.settings.globalShortcutDisabled, input.settings.globalShortcut)
  await persistNativeHostGlobalShortcutState(registered)
}

async function applyNativeHostSettingsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): Promise<void> {
  const shouldRebuildMenu = shouldRebuildMenuFromSettingsProjection(input.patch)
  const menuStatePatch = menuStatePatchFromSettingsProjection(input)
  applyI18nProjectionPatch(input)
  applyThemeProjectionPatch(input)
  if (Object.keys(menuStatePatch).length > 0) applyMenuRuntimeState(menuStatePatch)
  await applyGlobalShortcutDisabledProjectionPatch(input)
  if (shouldRebuildMenu) buildAppMenu()
}

export async function applyNativeHostProjection(input: NativeHostProjection): Promise<void> {
  if (input.prefs) {
    await applyNativeHostSettingsProjection({
      patch: input.prefs.patch,
      settings: input.prefs.settings,
    })
  }
  if (input.recentWorkspaces) {
    syncRecentWorkspaces(input.recentWorkspaces.recentWorkspaces)
    buildAppMenu()
  }
}
