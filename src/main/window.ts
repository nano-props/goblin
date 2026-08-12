// Single BrowserWindow. Multiple workspaces live inside the workspace switcher; we don't
// need multiple windows.
//
// Bounds are persisted: on second run the window comes back where the
// user left it. We listen on `resize` / `move` and write through a
// debounced settings layer so dragging doesn't hammer the disk. A final
// flush from `main.ts`'s before-quit handler captures the last move
// before exit (without it the very last drag is truncated).

import { BrowserWindow, app, ipcMain, screen } from 'electron'
import type { WebFrameMain } from 'electron'
import { loadWindowState, setWindowBounds, type WindowBounds } from '#/main/window-state.ts'
import { attachClientSurfaceWindow, detachClientSurfaceWindow } from '#/main/client-surface.ts'
import { plantEmbedAuthCookie } from '#/main/cookie-bootstrap.ts'
import { getEmbeddedServerRuntime } from '#/main/embedded-server-lifecycle.ts'
import {
  defaultTitleBarStyle,
  macTrafficLightPosition,
  supportsTitleBarOverlay,
  titleBarOverlayForTheme,
} from '#/main/title-bar-chrome.ts'
import { getPrimaryWindow as getRegisteredPrimaryWindow } from '#/main/client-surface-registry.ts'
import {
  allowBrowserWindowEntryUrl,
  createBrowserEntryUrl,
  createBrowserWindowWebPreferences,
  windowCanvasBackground,
} from '#/main/window-security.ts'
import { getTheme } from '#/main/theme.ts'
import { clientNodeLog, windowNodeLog } from '#/node/logger.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import {
  CLIENT_EFFECT_INTENT_CHANNEL,
  CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL,
  CLIENT_EFFECT_INTENT_READY_CHANNEL,
} from '#/shared/ipc-channels.ts'
import { isTrustedIpcEvent } from '#/main/ipc/trusted-webcontents.ts'

const DEFAULT_BOUNDS: WindowBounds = { width: 1100, height: 720 }
const PRIMARY_WINDOW_DOCUMENT_READY_TIMEOUT_MS = 30_000
const PRIMARY_WINDOW_SURFACE = {
  windowKey: 'primary',
  capabilities: {
    ipcBroadcast: true,
    themeSync: true,
  },
} as const

let primaryWindowCreation: Promise<BrowserWindow> | null = null
let primaryWindowDocumentGeneration = 0
let primaryWindowIntentReadinessWired = false

// Surface registration establishes IPC identity before the app loads. Intent
// delivery is a separate document-generation boundary. Existing surfaces fail
// fast unless their document is ready; an action that creates the primary
// window may wait only for that newly-created document generation.
type PrimaryWindowDocumentOutcome = { kind: 'ready' } | { kind: 'failed'; error: Error }

interface PrimaryWindowDocumentReadiness {
  window: BrowserWindow
  generation: number
  navigationStarted: boolean
  frame: WebFrameMain | null
  result: PrimaryWindowDocumentOutcome | null
  outcome: Promise<PrimaryWindowDocumentOutcome>
  settle: (outcome: PrimaryWindowDocumentOutcome) => void
}

let primaryWindowDocumentReadiness: PrimaryWindowDocumentReadiness | null = null

export function getPrimaryWindow(): BrowserWindow | null {
  return getRegisteredPrimaryWindow()
}

export function getOrCreatePrimaryWindow(): Promise<BrowserWindow> {
  const existing = getPrimaryWindow()
  if (existing) return Promise.resolve(existing)
  primaryWindowCreation ??= createPrimaryWindow().finally(() => {
    primaryWindowCreation = null
  })
  return primaryWindowCreation
}

export async function activatePrimaryWindow(): Promise<BrowserWindow> {
  await app.whenReady()
  const win = await getOrCreatePrimaryWindow()
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  if (process.platform === 'darwin') {
    app.show()
    app.focus({ steal: true })
  }
  win.focus()
  return win
}

export async function sendPrimaryWindowEffectIntent(intent: ClientEffectIntent): Promise<void> {
  const existing = getPrimaryWindow()
  if (existing) {
    const creating = primaryWindowCreation !== null
    const readiness = primaryWindowDocumentReadinessFor(existing)
    const activated = await activatePrimaryWindow()
    if (activated !== existing) throw new Error('Primary window was replaced before intent delivery')
    if (creating) await awaitPrimaryWindowDocument(readiness)
    await deliverPrimaryWindowEffectIntent(existing, readiness, intent)
    return
  }
  const expectedDocumentGeneration = primaryWindowDocumentGeneration + 1
  // Window creation remains owned by the shared BrowserWindow singleton and
  // Electron's load lifecycle. Do not race or cancel `activatePrimaryWindow`
  // from one intent: another activation may share the same creation, and the
  // normal load failure / renderer-gone / closed events already invalidate its
  // document. The bounded wait below begins only after creation returns and
  // governs the separate preload readiness acknowledgement.
  const win = await activatePrimaryWindow()
  const readiness = primaryWindowDocumentReadinessFor(win)
  if (readiness.generation !== expectedDocumentGeneration) {
    throw new Error(`Primary window renderer generation ${expectedDocumentGeneration} was superseded`)
  }
  await awaitPrimaryWindowDocument(readiness)
  await deliverPrimaryWindowEffectIntent(win, readiness, intent)
}

export async function sendExistingPrimaryWindowEffectIntent(intent: ClientEffectIntent): Promise<boolean> {
  const win = getPrimaryWindow()
  if (!win) return false
  // Existing-window delivery never waits for readiness or follows a later
  // document generation. Callers use this for best-effort effects, including
  // the final client-presentation flush during quit; correctness must not
  // depend on a renderer that is loading, reloading, or being replaced.
  await deliverPrimaryWindowEffectIntent(win, primaryWindowDocumentReadinessFor(win), intent)
  return true
}

export function reloadPrimaryWindow(): boolean {
  const win = getPrimaryWindow()
  if (!win) return false
  const previousReadiness = primaryWindowDocumentReadinessFor(win)
  win.webContents.reload()
  if (primaryWindowDocumentReadiness === previousReadiness) beginPrimaryWindowDocument(win, false)
  return true
}

function primaryWindowDocumentReadinessFor(win: BrowserWindow): PrimaryWindowDocumentReadiness {
  const readiness = primaryWindowDocumentReadiness
  if (!readiness || readiness.window !== win) throw new Error('Primary window renderer is not available')
  return readiness
}

async function awaitPrimaryWindowDocument(readiness: PrimaryWindowDocumentReadiness): Promise<void> {
  if (readiness.result?.kind === 'ready') return
  if (readiness.result?.kind === 'failed') throw readiness.result.error
  const deadline = createPrimaryWindowDocumentReadyDeadline(readiness.generation)
  try {
    const outcome = await Promise.race([readiness.outcome, deadline.outcome])
    if (outcome.kind === 'failed') throw outcome.error
  } finally {
    deadline.dispose()
  }
}

function createPrimaryWindowDocumentReadyDeadline(generation: number): {
  outcome: Promise<PrimaryWindowDocumentOutcome>
  dispose: () => void
} {
  // This deadline bounds only the exact document's preload handshake. It does
  // not bound `BrowserWindow.loadURL()`: window loading is shared lifecycle
  // state, while this deadline belongs to one discrete intent waiting for an
  // already-created document generation.
  const timeout = Promise.withResolvers<PrimaryWindowDocumentOutcome>()
  const handle = setTimeout(
    () =>
      timeout.resolve({
        kind: 'failed',
        error: new Error(
          `Primary window renderer generation ${generation} was not ready within ${PRIMARY_WINDOW_DOCUMENT_READY_TIMEOUT_MS}ms`,
        ),
      }),
    PRIMARY_WINDOW_DOCUMENT_READY_TIMEOUT_MS,
  )
  handle.unref()
  return {
    outcome: timeout.promise,
    dispose: () => clearTimeout(handle),
  }
}

function deliverPrimaryWindowEffectIntent(
  win: BrowserWindow,
  readiness: PrimaryWindowDocumentReadiness,
  intent: ClientEffectIntent,
): void {
  if (readiness.result === null) throw new Error('Primary window renderer is not ready')
  if (readiness.result.kind === 'failed') throw readiness.result.error
  if (primaryWindowDocumentReadiness !== readiness) {
    throw new Error(`Primary window renderer generation ${readiness.generation} was superseded`)
  }
  const frame = readiness.frame
  if (!frame || frame.detached || frame.isDestroyed() || win.isDestroyed() || win.webContents.isDestroyed()) {
    throw new Error('Primary window renderer is not available')
  }
  frame.send(CLIENT_EFFECT_INTENT_CHANNEL, intent)
}

function beginPrimaryWindowDocument(win: BrowserWindow, navigationStarted: boolean): PrimaryWindowDocumentReadiness {
  const previous = primaryWindowDocumentReadiness
  if (previous?.result === null) {
    settlePrimaryWindowDocument(previous, {
      kind: 'failed',
      error: new Error(`Primary window renderer generation ${previous.generation} was superseded`),
    })
  }
  const deferred = Promise.withResolvers<PrimaryWindowDocumentOutcome>()
  const readiness: PrimaryWindowDocumentReadiness = {
    window: win,
    generation: ++primaryWindowDocumentGeneration,
    navigationStarted,
    frame: null,
    result: null,
    outcome: deferred.promise,
    settle: deferred.resolve,
  }
  primaryWindowDocumentReadiness = readiness
  return readiness
}

function settlePrimaryWindowDocument(
  readiness: PrimaryWindowDocumentReadiness,
  outcome: PrimaryWindowDocumentOutcome,
): void {
  if (readiness.result !== null) return
  readiness.result = outcome
  readiness.settle(outcome)
}

function challengePrimaryWindowDocument(win: BrowserWindow): void {
  const readiness = primaryWindowDocumentReadiness
  if (!readiness || readiness.window !== win || readiness.result !== null) return
  const frame = win.webContents.mainFrame
  readiness.frame = frame
  try {
    frame.send(CLIENT_EFFECT_INTENT_CHALLENGE_CHANNEL, readiness.generation)
  } catch (err) {
    failPrimaryWindowDocument(
      win,
      err instanceof Error ? err : new Error('Primary window renderer readiness challenge failed'),
    )
  }
}

function markPrimaryWindowDocumentReady(win: BrowserWindow, frame: WebFrameMain, generation: unknown): void {
  const readiness = primaryWindowDocumentReadiness
  if (
    !readiness ||
    readiness.window !== win ||
    readiness.frame === null ||
    generation !== readiness.generation ||
    frame.processId !== readiness.frame.processId ||
    frame.routingId !== readiness.frame.routingId
  ) {
    return
  }
  settlePrimaryWindowDocument(readiness, { kind: 'ready' })
}

function wirePrimaryWindowIntentReadiness(): void {
  if (primaryWindowIntentReadinessWired) return
  primaryWindowIntentReadinessWired = true
  ipcMain.on(CLIENT_EFFECT_INTENT_READY_CHANNEL, (event, generation: unknown) => {
    const win = getPrimaryWindow()
    if (!win || event.sender !== win.webContents || !event.senderFrame || !isTrustedIpcEvent(event)) return
    markPrimaryWindowDocumentReady(win, event.senderFrame, generation)
  })
}

function failPrimaryWindowDocument(win: BrowserWindow, error: Error): void {
  const readiness = primaryWindowDocumentReadiness
  if (!readiness || readiness.window !== win) return
  if (readiness.result === null) {
    settlePrimaryWindowDocument(readiness, { kind: 'failed', error })
    return
  }
  if (readiness.result.kind === 'failed') return
  const failedReadiness = beginPrimaryWindowDocument(win, true)
  settlePrimaryWindowDocument(failedReadiness, { kind: 'failed', error })
}

/** Constrain saved bounds against current display geometry — a window
 *  saved on an external monitor that's no longer connected would
 *  otherwise open offscreen. */
function clampToDisplay(bounds: WindowBounds): WindowBounds {
  if (bounds.x === undefined || bounds.y === undefined) return bounds
  const display = screen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  })
  const wa = display.workArea
  const width = Math.min(bounds.width, wa.width)
  const height = Math.min(bounds.height, wa.height)
  // If the saved origin is fully outside the matched display's work
  // area, drop x/y so Electron centers the window. Partial overlap is
  // fine — the user can drag it back.
  const onscreen =
    bounds.x + bounds.width > wa.x &&
    bounds.x < wa.x + wa.width &&
    bounds.y + bounds.height > wa.y &&
    bounds.y < wa.y + wa.height
  if (!onscreen) return { width, height }
  return { x: bounds.x, y: bounds.y, width, height }
}

async function createPrimaryWindow(): Promise<BrowserWindow> {
  wirePrimaryWindowIntentReadiness()
  const backgroundColor = windowCanvasBackground()
  const { resolved, colorTheme } = getTheme()

  const windowState = await loadWindowState()
  const saved = windowState.windowBounds
  const bounds = saved ? clampToDisplay(saved) : DEFAULT_BOUNDS

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 480,
    backgroundColor,
    titleBarStyle: defaultTitleBarStyle(),
    titleBarOverlay: titleBarOverlayForTheme(resolved, colorTheme, TITLE_BAR_HEIGHT_PX),
    trafficLightPosition: macTrafficLightPosition(TITLE_BAR_HEIGHT_PX),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: await createBrowserWindowWebPreferences(),
  })
  const initialDocumentReadiness = beginPrimaryWindowDocument(win, false)
  win.webContents.on('did-start-navigation', (event) => {
    if (!event.isMainFrame || event.isSameDocument) return
    const current = primaryWindowDocumentReadiness
    if (current?.window === win && !current.navigationStarted && current.result === null) {
      current.navigationStarted = true
      return
    }
    beginPrimaryWindowDocument(win, true)
  })
  win.webContents.on('did-stop-loading', () => {
    challengePrimaryWindowDocument(win)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) {
      clientNodeLog.debug({ validatedURL }, 'navigation cancelled')
      return
    }
    clientNodeLog.error({ validatedURL, errorCode, errorDescription }, 'failed to load')
    if (isMainFrame !== false) {
      failPrimaryWindowDocument(win, new Error(`Primary window failed to load: ${errorDescription}`))
    }
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    clientNodeLog.error({ preloadPath, err: error }, 'preload failed')
    failPrimaryWindowDocument(win, new Error(`Primary window preload failed: ${error.message}`))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    clientNodeLog.error({ details }, 'process gone')
    failPrimaryWindowDocument(win, new Error(`Primary window renderer exited: ${details.reason}`))
  })
  attachClientSurfaceWindow(win, { surface: PRIMARY_WINDOW_SURFACE })
  const { url } = createBrowserEntryUrl({ routePath: '/' })
  allowBrowserWindowEntryUrl(win, url.toString())
  // Plant the auth cookie on the client's session BEFORE
  // `loadURL` so authenticated client requests are ready as
  // soon as the app mounts. The first boot request is public
  // i18n; the auth-gated `useAccessTokenStatus` whoami probe
  // runs after the client entrypoint has hydrated i18n and
  // mounted the app. The default Electron session is shared; the
  // cookie is host-scoped with `Path=/`, while popups are denied.
  const runtime = getEmbeddedServerRuntime()
  if (runtime?.accessToken) {
    try {
      await plantEmbedAuthCookie({
        accessToken: runtime.accessToken,
        url: url.toString(),
        webContents: win.webContents,
      })
    } catch (err) {
      windowNodeLog.warn({ err }, 'failed to plant embed auth cookie; falling back to token gate')
    }
  }
  // Persist bounds. We listen on both `resize` and `move` because the
  // user can do either independently. `getNormalBounds` returns the
  // pre-maximize size so a maximized window doesn't overwrite the
  // user's actual drag-resize state.
  const persistBounds = () => {
    if (win.isDestroyed()) return
    if (win.isMinimized() || win.isMaximized() || win.isFullScreen()) return
    const b = win.getNormalBounds()
    void setWindowBounds({ x: b.x, y: b.y, width: b.width, height: b.height })
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)

  win.on('closed', () => {
    failPrimaryWindowDocument(win, new Error('Primary window closed before the renderer was ready'))
    detachClientSurfaceWindow(win, PRIMARY_WINDOW_SURFACE)
  })

  try {
    await win.loadURL(url.toString())
  } catch (err) {
    settlePrimaryWindowDocument(initialDocumentReadiness, {
      kind: 'failed',
      error: err instanceof Error ? err : new Error('Primary window failed to load'),
    })
    windowNodeLog.warn({ err }, 'failed to load app URL')
  }
  return win
}

export function applyPrimaryWindowTitleBarTheme(theme: 'light' | 'dark'): void {
  if (!supportsTitleBarOverlay()) return
  const win = getPrimaryWindow()
  if (!win || win.isDestroyed()) return
  const overlay = titleBarOverlayForTheme(theme, getTheme().colorTheme, TITLE_BAR_HEIGHT_PX)
  if (!overlay) return
  try {
    win.setTitleBarOverlay(overlay)
  } catch {}
}

/** Restore the primary window to its default size, centered on the display
 *  it currently lives on. On macOS, exiting fullscreen is an async system
 *  animation — `setBounds` called against a still-transitioning window
 *  is dropped, so we defer the resize to the `leave-full-screen` event
 *  rather than firing it inline. Maximize/minimize unwinding is
 *  synchronous everywhere we care about, so those run inline. The
 *  existing resize/move listeners persist the new bounds. Wired to the
 *  Window > Reset Window menu item so users have a one-click escape from
 *  an awkward drag-resize. */
export function resetPrimaryWindow(): void {
  const win = getPrimaryWindow()
  if (!win || win.isDestroyed()) return
  const applyDefault = () => {
    if (win.isDestroyed()) return
    // restore() before unmaximize(): on Windows a minimized-from-maximized
    // window restores to maximized first, then needs unmaximize.
    if (win.isMinimized()) win.restore()
    if (win.isMaximized()) win.unmaximize()
    const display = screen.getDisplayMatching(win.getBounds())
    const wa = display.workArea
    const width = Math.min(DEFAULT_BOUNDS.width, wa.width)
    const height = Math.min(DEFAULT_BOUNDS.height, wa.height)
    const x = wa.x + Math.max(0, Math.round((wa.width - width) / 2))
    const y = wa.y + Math.max(0, Math.round((wa.height - height) / 2))
    win.setBounds({ x, y, width, height }, true)
  }
  if (win.isFullScreen()) {
    win.once('leave-full-screen', applyDefault)
    win.setFullScreen(false)
  } else {
    applyDefault()
  }
}
