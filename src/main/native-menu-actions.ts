import { app, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { broadcastRpcEvent } from '#/main/renderer-surface-events.ts'
import { applyNativeHostClearRecentReposState } from '#/main/native-host-settings-effects.ts'
import { applyLangPref, t } from '#/main/i18n/index.ts'
import { applyMenuRuntimeState } from '#/main/menu-state.ts'
import { clearSettingsRecentRepos } from '#/main/settings-server-client.ts'
import { setThemePref } from '#/main/theme.ts'
import { getEmbeddedServerUrl } from '#/main/window-shell.ts'
import { openHttpExternal } from '#/main/external-url.ts'
import type { LangPref, ThemePref } from '#/shared/rpc.ts'

export async function setThemePrefFromMenu(pref: ThemePref): Promise<void> {
  try {
    await setThemePref(pref)
  } catch (err) {
    console.warn('[menu] failed to set theme preference', err)
  }
}

export async function setLangPrefFromMenu(pref: LangPref, options: { rebuildMenu: () => void }): Promise<void> {
  try {
    const payload = await applyLangPref(pref)
    if (!payload) return
    applyMenuRuntimeState({ langPref: payload.pref })
    options.rebuildMenu()
    broadcastRpcEvent({ type: 'i18n-changed', payload })
  } catch (err) {
    console.warn('[menu] failed to set language preference', err)
  }
}

export async function openWebVersionFromMenu(): Promise<void> {
  const baseUrl = getEmbeddedServerUrl()
  if (!baseUrl) {
    dialog.showErrorBox(t('menu.file.open-in-browser'), 'Embedded web server is unavailable.')
    return
  }
  const opened = await openHttpExternal(baseUrl)
  if (opened) return
  dialog.showErrorBox(t('menu.file.open-in-browser'), baseUrl)
}

export async function clearRecentReposFromMenu(): Promise<void> {
  await clearSettingsRecentRepos()
  await applyNativeHostClearRecentReposState()
}

export async function openDataFolder(): Promise<void> {
  try {
    const dir = app.getPath('userData')
    await fs.mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) reportOpenDataFolderError(error)
  } catch (err) {
    reportOpenDataFolderError(err)
  }
}

function reportOpenDataFolderError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn('[menu] failed to open data folder', err)
  dialog.showErrorBox(t('menu.file.open-data-folder'), message)
}
