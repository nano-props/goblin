import { BrowserWindow, dialog, ipcMain } from 'electron'
import { activatePrimaryWindow, getPrimaryWindow } from '#/main/window.ts'
import { consumeExternalOpenPaths } from '#/main/external-open.ts'
import { focusedRegisteredSurface } from '#/main/client-surface-registry.ts'
import { sendClientEffectIntent } from '#/main/client-surface-events.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { openHttpExternal, openHttpsExternal } from '#/main/external-url.ts'
import type { SettingsPage } from '#/shared/api-types.ts'
import {
  HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
  HOST_OPEN_DIRECTORY_DIALOG_CHANNEL,
  HOST_OPEN_EXTERNAL_URL_CHANNEL,
  HOST_OPEN_SETTINGS_WINDOW_CHANNEL,
} from '#/shared/ipc-channels.ts'

function callerWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? focusedRegisteredSurface()?.window ?? getPrimaryWindow() ?? null
}

export function wireShellIpc(): void {
  ipcMain.handle(HOST_OPEN_SETTINGS_WINDOW_CHANNEL, async (event, input?: { page?: SettingsPage }) => {
    if (!isTrustedIpcEvent(event)) return false
    const win = await activatePrimaryWindow()
    sendClientEffectIntent(win, {
      type: 'open-settings-requested',
      page: input?.page ?? 'general',
    })
    return true
  })

  ipcMain.handle(
    HOST_OPEN_EXTERNAL_URL_CHANNEL,
    async (event, input?: { url?: unknown; allowHttp?: unknown }): Promise<{ ok: boolean; message: string }> => {
      if (!isTrustedIpcEvent(event)) return { ok: false, message: 'error.invalid-url' }
      const url = typeof input?.url === 'string' ? input.url : ''
      const allowHttp = input?.allowHttp === true
      const ok = allowHttp ? await openHttpExternal(url) : await openHttpsExternal(url)
      return ok ? { ok: true, message: url } : { ok: false, message: 'error.invalid-url' }
    },
  )

  ipcMain.handle(
    HOST_OPEN_DIRECTORY_DIALOG_CHANNEL,
    async (event, input?: { title?: unknown }): Promise<string | null> => {
      if (!isTrustedIpcEvent(event)) return null
      const title = typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : 'Choose Folder'
      const win = callerWindow(event)
      const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'], title }
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    },
  )

  ipcMain.handle(
    HOST_CONSUME_EXTERNAL_OPEN_PATHS_CHANNEL,
    async (event): Promise<string[]> => (isTrustedIpcEvent(event) ? consumeExternalOpenPaths() : []),
  )
}
