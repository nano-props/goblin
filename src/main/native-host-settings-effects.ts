import { app } from 'electron'
import { resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { broadcastRpcEvent } from '#/main/renderer-surface-events.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import { setSettingsGlobalShortcutState } from '#/main/settings-server-client.ts'
import { syncGlobalShortcuts } from '#/main/shortcuts.ts'
import { applyThemeSettingsProjection } from '#/main/theme.ts'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { NativeShellProjection, NativeSettingsProjectionPatch, NativeSettingsProjectionState } from '#/shared/rpc.ts'

// Native-host application of server-owned settings changes.
//
// Naming rule:
// - `broadcast*` = publish renderer-visible state that main has already resolved
//   or validated.
// - `apply*` = mutate native host chrome / menu / OS integration state.
//
// Keep this module narrow: only retain effects that are actually shared across
// multiple main-side call sites.
export async function broadcastNativeHostGlobalShortcutState(accelerator: string, registered: boolean): Promise<void> {
  await setSettingsGlobalShortcutState(registered)
  broadcastRpcEvent({ type: 'global-shortcut-changed', state: { accelerator, registered } })
}

function menuStatePatchFromSettingsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): {
  langPref?: NativeSettingsProjectionState['lang']
  shortcutsDisabled?: boolean
  swapCloseShortcuts?: boolean
} {
  const menuStatePatch: {
    langPref?: NativeSettingsProjectionState['lang']
    shortcutsDisabled?: boolean
    swapCloseShortcuts?: boolean
  } = {}
  if (input.patch.lang !== undefined) menuStatePatch.langPref = input.settings.lang
  if (input.patch.shortcutsDisabled !== undefined) menuStatePatch.shortcutsDisabled = input.settings.shortcutsDisabled
  if (input.patch.swapCloseShortcuts !== undefined) menuStatePatch.swapCloseShortcuts = input.settings.swapCloseShortcuts
  return menuStatePatch
}

function shouldRebuildMenuFromSettingsProjection(patch: NativeSettingsProjectionPatch): boolean {
  return patch.lang !== undefined || patch.shortcutsDisabled !== undefined || patch.swapCloseShortcuts !== undefined
}

function applyI18nSettingsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): void {
  if (input.patch.lang === undefined) return
  setCurrentLang(resolveLang(input.settings.lang))
}

function applyThemeSettingsPrefsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): void {
  if (input.patch.theme === undefined && input.patch.colorTheme === undefined) return
  applyThemeSettingsProjection({ theme: input.settings.theme, colorTheme: input.settings.colorTheme })
}

async function applyGlobalShortcutDisabledProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): Promise<void> {
  if (input.patch.globalShortcutDisabled === undefined) return
  const registered = syncGlobalShortcuts(input.settings.globalShortcutDisabled, input.settings.globalShortcut)
  await broadcastNativeHostGlobalShortcutState(input.settings.globalShortcut, registered)
}

export async function applyNativeHostSettingsPrefsProjection(input: {
  patch: NativeSettingsProjectionPatch
  settings: NativeSettingsProjectionState
}): Promise<void> {
  const shouldRebuildMenu = shouldRebuildMenuFromSettingsProjection(input.patch)
  const menuStatePatch = menuStatePatchFromSettingsProjection(input)
  applyI18nSettingsProjection(input)
  applyThemeSettingsPrefsProjection(input)
  if (Object.keys(menuStatePatch).length > 0) applyMenuRuntimeState(menuStatePatch)
  await applyGlobalShortcutDisabledProjection(input)
  if (shouldRebuildMenu) buildAppMenu()
}

function syncRecentDocumentOnAdd(repo: RepoSessionEntry, addRecentDocument: (path: string) => void): void {
  if (repo.kind !== 'local') return
  addRecentDocument(repo.id)
}

function applyNativeHostRecentReposMenuState(recentRepos: RepoSessionEntry[]): void {
  applyMenuRuntimeState({ recentRepos })
  buildAppMenu()
}

function applyNativeHostRecentReposProjection(
  recentRepos: RepoSessionEntry[],
  options: {
    addRecentDocument?: (path: string) => void
    addedRepo?: RepoSessionEntry
  } = {},
): void {
  if (options.addedRepo && options.addRecentDocument) syncRecentDocumentOnAdd(options.addedRepo, options.addRecentDocument)
  applyNativeHostRecentReposMenuState(recentRepos)
}

function applyNativeShellProjectionOptions(options: {
  clearRecentDocuments?: boolean
}): void {
  if (options.clearRecentDocuments) app.clearRecentDocuments()
}

export async function applyNativeHostShellProjection(
  input: NativeShellProjection,
  options: {
    addRecentDocument?: (path: string) => void
    clearRecentDocuments?: boolean
  } = {},
): Promise<void> {
  if (input.prefs) {
    await applyNativeHostSettingsPrefsProjection({
      patch: input.prefs.patch,
      settings: input.prefs.settings,
    })
  }
  applyNativeShellProjectionOptions(options)
  if (input.recentRepos) {
    applyNativeHostRecentReposProjection(input.recentRepos.recentRepos, {
      addedRepo: input.recentRepos.addedRepo,
      addRecentDocument: options.addRecentDocument,
    })
  }
}
