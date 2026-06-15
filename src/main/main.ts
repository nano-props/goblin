import { app, dialog } from 'electron'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { activateMainWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { flushWindowState } from '#/main/window-state.ts'
import { registerBootstrapIpc } from '#/main/window-shell.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { initializeMenuRuntimeState } from '#/main/menu-state.ts'
import { syncRecentRepos } from '#/main/recent-repos.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireIpc } from '#/main/ipc.ts'
import { wireShellBridgeIpc } from '#/main/shell-bridge.ts'
import { windowNodeLog, windowStateNodeLog, serverNodeLog } from '#/node/logger.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { enqueueExternalOpenPath } from '#/main/external-open.ts'
import { broadcastRendererEffectIntent } from '#/main/renderer-surface-events.ts'
import { getSettingsSnapshot, setSettingsGlobalShortcutState } from '#/main/settings-server-client.ts'
import { startEmbeddedServer, stopEmbeddedServer } from '#/main/server-manager.ts'

function activateMainWindowFromEvent(): void {
  void activationBarrier
    .then(() => {
      if (isQuitting) return null
      return activateMainWindow()
    })
    .catch((err) => {
      windowNodeLog.error({ err }, 'failed to activate main window')
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
    await finalizeMainProcessExit()
  })

  await activationBarrier
  if (isQuitting) return
  await activateMainWindow()
  if (isQuitting) return
  app.on('activate', activateMainWindowFromEvent)
}

async function finalizeMainProcessExit(): Promise<void> {
  try {
    broadcastRendererEffectIntent({ type: 'app-quitting' })
    const windowStateFlushed = await flushWindowState()
    if (!windowStateFlushed) windowStateNodeLog.error('final flush failed before quit')
    await stopEmbeddedServer()
  } finally {
    unregisterAppShortcuts()
    app.exit(0)
  }
}

async function initializeMainProcess(): Promise<void> {
  await app.whenReady()
  await startEmbeddedServerForMainProcess()
  const settingsSnapshot = await getSettingsSnapshot()
  await initTheme({ theme: settingsSnapshot.theme, colorTheme: settingsSnapshot.colorTheme })
  await initializeRuntimeState(settingsSnapshot)
  wireMainProcessIpc()
  await syncInitialGlobalShortcutState(settingsSnapshot)
}

async function startEmbeddedServerForMainProcess(): Promise<void> {
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
    swapCloseShortcuts: settingsSnapshot.swapCloseShortcuts,
    langPref: settingsSnapshot.lang,
    workspaceLayout: settingsSnapshot.session.workspaceLayout,
  })
  setCurrentLang(resolveLang(settingsSnapshot.lang))
  syncRecentRepos(settingsSnapshot.recentRepos)
  buildAppMenu()
}

function wireMainProcessIpc(): void {
  wireIpc()
  wireShellBridgeIpc()
  wireTerminalIpc()
  // Bootstrap handler must be registered once, before the first
  // BrowserWindow is created — the preload synchronously reads its
  // bootstrap token during startup, and a missing handler makes the
  // preload fall back to defaults.
  registerBootstrapIpc()
}

async function syncInitialGlobalShortcutState(settingsSnapshot: SettingsSnapshot): Promise<void> {
  const globalShortcutRegistered = syncGlobalShortcuts(
    settingsSnapshot.globalShortcutDisabled,
    settingsSnapshot.globalShortcut,
  )
  await setSettingsGlobalShortcutState(globalShortcutRegistered)
}

void main()
