import { app } from 'electron'
import { activateMainWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { loadSettings, flushSettings } from '#/main/settings.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireRpcIpc } from '#/main/rpc.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { enqueueExternalOpenPath } from '#/main/external-open.ts'

function activateMainWindowFromEvent(): void {
  void activationBarrier
    .then(() => {
      if (isQuitting) return null
      return activateMainWindow()
    })
    .catch((err) => {
      console.error('[window] failed to activate main window', err)
    })
}

let activationBarrier: Promise<void> = Promise.resolve()
let isQuitting = false

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (!enqueueExternalOpenPath(path)) return
  activateMainWindowFromEvent()
})

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  activationBarrier = initializeMainProcess()

  app.on('second-instance', () => {
    activateMainWindowFromEvent()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    unregisterAppShortcuts()
  })

  // Drain debounced settings writes before exit so the last theme pick,
  // window resize, or session change isn't lost. We exit explicitly
  // after the flush: re-entering app.quit from before-quit is not
  // reliable across Electron quit paths, and app.exit skips will-quit,
  // so do will-quit cleanup here too.
  app.on('before-quit', async (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    try {
      const flushed = await flushSettings()
      if (!flushed) console.error('[settings] final flush failed before quit')
    } finally {
      unregisterAppShortcuts()
      app.exit(0)
    }
  })

  await activationBarrier
  if (isQuitting) return
  await activateMainWindow()
  if (isQuitting) return
  app.on('activate', activateMainWindowFromEvent)
}

async function initializeMainProcess(): Promise<void> {
  await app.whenReady()

  // Settings before theme — initTheme reads the persisted pref.
  const settings = await loadSettings()
  await initTheme()

  // Resolve language BEFORE buildMenu — every menu label runs through
  // `t()` and would otherwise render in the default ('en') for the
  // first frame.
  assertDictionaryParity(!app.isPackaged)
  setCurrentLang(resolveLang(settings.lang))

  wireRpcIpc()
  wireTerminalIpc()

  buildAppMenu()
  syncGlobalShortcuts(settings.globalShortcutDisabled, settings.globalShortcut)
}

void main()
