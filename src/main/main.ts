import { app, dialog, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { SettingsSnapshot } from '#/shared/api-types.ts'
import { activatePrimaryWindow } from '#/main/window.ts'
import { initTheme } from '#/main/theme.ts'
import { flushWindowState } from '#/main/window-state.ts'
import { buildAppMenu } from '#/main/menu.ts'
import { initializeMenuRuntimeState } from '#/main/menu-state.ts'
import { syncRecentWorkspaces } from '#/main/recent-workspaces.ts'
import { assertDictionaryParity, resolveLang, setCurrentLang } from '#/main/i18n/index.ts'
import { wireNativeHostIpc } from '#/main/native-host-ipc-router.ts'
import { wireShellIpc } from '#/main/shell-ipc.ts'
import { wireAccessTokenIpc } from '#/main/access-token-ipc.ts'
import { windowNodeLog, windowStateNodeLog } from '#/node/logger.ts'
import { wireTerminalIpc } from '#/main/terminal.ts'
import { syncGlobalShortcuts, unregisterAppShortcuts } from '#/main/shortcuts.ts'
import { enqueueExternalOpenPath } from '#/main/external-open.ts'
import { broadcastClientEffectIntent } from '#/main/client-surface-events.ts'
import { APP_QUIT_DRAINED_CHANNEL } from '#/shared/ipc-channels.ts'
import { isAppQuitDrainResult, type AppQuitDrainResult } from '#/shared/app-quit-drain.ts'
import { getSettingsSnapshot, setGlobalShortcutState } from '#/main/settings-server-client.ts'
import { startEmbeddedServer, stopEmbeddedServer } from '#/main/embedded-server-lifecycle.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'
import { startNativeSettingsProjectionSync, stopNativeSettingsProjectionSync } from '#/main/native-settings-projection-sync.ts'

function activatePrimaryWindowFromEvent(): void {
  void activationBarrier
    .then(() => {
      if (isQuitting) return null
      return activateClient()
    })
    .catch((err) => {
      windowNodeLog.error({ err }, 'failed to activate primary window')
    })
}

let activationBarrier: Promise<void> = Promise.resolve()
let isQuitting = false
let clientActivated = false
let exitIntent: 'none' | 'normal' | 'fatal' = 'none'
let finalizationPromise: Promise<void> | null = null
let finalizationComplete = false
const CLIENT_QUIT_DRAIN_TIMEOUT_MS = 1000
type ClientQuitDrain = AppQuitDrainResult | { ok: false; timedOut: true }

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
    if (finalizationComplete) return
    event.preventDefault()
    isQuitting = true
    if (exitIntent === 'none') exitIntent = 'normal'
    finalizationPromise ??= finalizeNativeHostExit()
    await finalizationPromise
    finalizationComplete = true
  })

  await activationBarrier
  if (isQuitting) return
  await activateClient()
  if (isQuitting) return
  app.on('activate', activatePrimaryWindowFromEvent)
}

async function finalizeNativeHostExit(): Promise<void> {
  try {
    if (clientActivated) {
      const clientQuitDrain = waitForClientQuitDrain()
      broadcastClientEffectIntent({ type: 'app-quitting' })
      const clientQuitDrainResult = await clientQuitDrain
      if ('timedOut' in clientQuitDrainResult) {
        windowNodeLog.warn('timed out waiting for client quit persistence drain')
      } else if (!clientQuitDrainResult.ok) {
        windowNodeLog.warn({ err: clientQuitDrainResult.error }, 'client quit persistence drain failed')
      }
      const windowStateFlushed = await flushWindowState()
      if (!windowStateFlushed) windowStateNodeLog.error('final flush failed before quit')
    }
    stopNativeSettingsProjectionSync()
    await stopEmbeddedServer('app-quit')
  } finally {
    unregisterAppShortcuts()
    app.exit(exitIntent === 'fatal' ? 1 : 0)
  }
}

async function activateClient(): Promise<void> {
  await activatePrimaryWindow()
  clientActivated = true
}

async function waitForClientQuitDrain(): Promise<ClientQuitDrain> {
  return await new Promise((resolve) => {
    let settled = false
    const finish = (drain: ClientQuitDrain) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ipcMain.removeHandler(APP_QUIT_DRAINED_CHANNEL)
      resolve(drain)
    }
    const timeout = setTimeout(() => finish({ ok: false, timedOut: true }), CLIENT_QUIT_DRAIN_TIMEOUT_MS)
    ipcMain.handle(APP_QUIT_DRAINED_CHANNEL, (event, result: unknown) =>
      handleTrustedClientQuitDrainBoundary(event, result, finish),
    )
  })
}

function handleTrustedClientQuitDrainBoundary(
  event: IpcMainInvokeEvent,
  result: unknown,
  finish: (drain: ClientQuitDrain) => void,
): boolean {
  if (!isTrustedIpcEvent(event)) return false
  finish(
    isAppQuitDrainResult(result)
      ? result
      : { ok: false, error: { name: 'Error', message: 'Malformed quit drain result' } },
  )
  return true
}

async function initializeNativeHost(): Promise<void> {
  await app.whenReady()
  await startEmbeddedServer()
  const settingsSnapshot = await getSettingsSnapshot()
  await initTheme({ theme: settingsSnapshot.theme, colorTheme: settingsSnapshot.colorTheme })
  await initializeRuntimeState(settingsSnapshot)
  wireNativeHostIpc()
  wireShellIpc()
  wireTerminalIpc()
  wireAccessTokenIpc()
  await syncInitialGlobalShortcutState(settingsSnapshot)
  startNativeSettingsProjectionSync(settingsSnapshot)
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
  syncRecentWorkspaces(settingsSnapshot.recentWorkspaces)
  buildAppMenu()
}

async function syncInitialGlobalShortcutState(settingsSnapshot: SettingsSnapshot): Promise<void> {
  const globalShortcutRegistered = syncGlobalShortcuts(
    settingsSnapshot.globalShortcutDisabled,
    settingsSnapshot.globalShortcut,
  )
  await setGlobalShortcutState(globalShortcutRegistered)
}

void main().catch((err) => {
  if (exitIntent === 'normal') return
  exitIntent = 'fatal'
  windowNodeLog.error({ err }, 'failed to initialize native host')
  const message = err instanceof Error ? err.message : String(err)
  dialog.showErrorBox('Goblin failed to start', `Native host initialization failed.\n\n${message}`)
  app.quit()
})
