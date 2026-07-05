import { app, dialog } from 'electron'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { activatePrimaryWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { flushWindowState } from '#/main/window-state.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { initializeMenuRuntimeState } from '#/main/menu-state.ts'
import { syncRecentRepos } from '#/main/recent-repos.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireNativeHostIpc } from '#/main/native-host-ipc-router.ts'
import { wireShellIpc } from '#/main/shell-ipc.ts'
import { wireClipboardIpc } from '#/main/clipboard-ipc.ts'
import { wireAccessTokenIpc } from '#/main/access-token-ipc.ts'
import { windowNodeLog, windowStateNodeLog, serverNodeLog } from '#/node/logger.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { enqueueExternalOpenPath } from '#/main/external-open.ts'
import { broadcastClientEffectIntent } from '#/main/client-surface-events.ts'
import { getSettingsSnapshot, setGlobalShortcutState } from '#/main/settings-server-client.ts'
import { startEmbeddedServer, stopEmbeddedServer } from '#/main/embedded-server-lifecycle.ts'

function activatePrimaryWindowFromEvent(): void {
  void activationBarrier
    .then(() => {
      if (isQuitting) return null
      return activatePrimaryWindow()
    })
    .catch((err) => {
      windowNodeLog.error({ err }, 'failed to activate primary window')
    })
}

let activationBarrier: Promise<void> = Promise.resolve()
let isQuitting = false

app.on('open-file', (event, path) => {
  event.preventDefault()
  if (!enqueueExternalOpenPath(path)) return
  activatePrimaryWindowFromEvent()
})

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  activationBarrier = initializeNativeHost()

  app.on('second-instance', () => {
    activatePrimaryWindowFromEvent()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    unregisterAppShortcuts()
  })

  // Drain debounced window-state writes before exit so the last resize or
  // move isn't lost. Settings writes are awaited at their server boundary.
  // We exit explicitly after the flush: re-entering app.quit from
  // before-quit is not reliable across Electron quit paths, and app.exit
  // skips will-quit, so do will-quit cleanup here too.
  app.on('before-quit', async (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    await finalizeNativeHostExit()
  })

  await activationBarrier
  if (isQuitting) return
  await activatePrimaryWindow()
  if (isQuitting) return
  app.on('activate', activatePrimaryWindowFromEvent)
}

async function finalizeNativeHostExit(): Promise<void> {
  try {
    broadcastClientEffectIntent({ type: 'app-quitting' })
    const windowStateFlushed = await flushWindowState()
    if (!windowStateFlushed) windowStateNodeLog.error('final flush failed before quit')
    await stopEmbeddedServer()
  } finally {
    unregisterAppShortcuts()
    app.exit(0)
  }
}

async function initializeNativeHost(): Promise<void> {
  await app.whenReady()
  await startEmbeddedServerForNativeHost()
  const settingsSnapshot = await getSettingsSnapshot()
  await initTheme({ theme: settingsSnapshot.theme, colorTheme: settingsSnapshot.colorTheme })
  await initializeRuntimeState(settingsSnapshot)
  wireNativeHostIpc()
  wireShellIpc()
  wireTerminalIpc()
  wireClipboardIpc()
  wireAccessTokenIpc()
  await syncInitialGlobalShortcutState(settingsSnapshot)
}

async function startEmbeddedServerForNativeHost(): Promise<void> {
  try {
    await startEmbeddedServer()
  } catch (err) {
    serverNodeLog.warn({ err }, 'failed to start embedded server')
    const message = err instanceof Error ? err.message : String(err)
    dialog.showErrorBox('Goblin failed to start', `Embedded web server failed to start.\n\n${message}`)
    throw err
  }
}

async function initializeRuntimeState(settingsSnapshot: SettingsSnapshot): Promise<void> {
  // Resolve language BEFORE buildMenu — every menu label runs through
  // `t()` and would otherwise render in the default ('en') for the
  // first frame.
  assertDictionaryParity(!app.isPackaged)
  initializeMenuRuntimeState({
    shortcutsDisabled: settingsSnapshot.shortcutsDisabled,
    langPref: settingsSnapshot.lang,
  })
  setCurrentLang(resolveLang(settingsSnapshot.lang))
  syncRecentRepos(settingsSnapshot.recentRepos)
  buildAppMenu()
}

async function syncInitialGlobalShortcutState(settingsSnapshot: SettingsSnapshot): Promise<void> {
  const globalShortcutRegistered = syncGlobalShortcuts(
    settingsSnapshot.globalShortcutDisabled,
    settingsSnapshot.globalShortcut,
  )
  await setGlobalShortcutState(globalShortcutRegistered)
}

void main()
