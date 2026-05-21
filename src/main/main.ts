import { app } from 'electron'
import { createMainWindow, getMainWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { loadSettings, flushSettings } from '#/main/settings.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireRepoIpc } from '#/main/ipc/repo.ts'
import { wireThemeIpc } from '#/main/ipc/theme.ts'
import { wireSettingsIpc } from '#/main/ipc/settings.ts'
import { wireMenuIpc } from '#/main/ipc/menu.ts'
import { wireI18nIpc } from '#/main/ipc/i18n.ts'
import { wireOpenersIpc } from '#/main/ipc/openers.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    } else {
      void createMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    unregisterAppShortcuts()
  })

  app.on('activate', () => {
    if (!getMainWindow()) void createMainWindow()
  })

  // Drain debounced settings writes before exit so the last theme pick,
  // window resize, or session change isn't lost. `isQuitting` guards
  // the second pass — app.exit fires before-quit again, and without
  // the guard we'd loop.
  let isQuitting = false
  app.on('before-quit', async (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    try {
      await flushSettings()
    } finally {
      app.exit(0)
    }
  })

  await app.whenReady()

  // Settings before theme — initTheme reads the persisted pref.
  const settings = await loadSettings()
  await initTheme()

  // Resolve language BEFORE buildMenu — every menu label runs through
  // `t()` and would otherwise render in the default ('en') for the
  // first frame.
  assertDictionaryParity(!app.isPackaged)
  setCurrentLang(resolveLang(settings.lang))

  wireRepoIpc()
  wireThemeIpc()
  wireSettingsIpc()
  wireMenuIpc()
  wireI18nIpc()
  wireOpenersIpc()

  buildAppMenu()
  syncGlobalShortcuts(settings.shortcutsDisabled, settings.globalShortcut)

  await createMainWindow()
}

void main()
