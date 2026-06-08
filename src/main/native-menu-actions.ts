import { app, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { t } from '#/main/i18n/index.ts'
import { getEmbeddedServerUrl } from '#/main/window-shell.ts'
import { openHttpExternal } from '#/main/external-url.ts'

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
