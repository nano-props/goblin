// Single BrowserWindow. Multi-repo lives inside the repository switcher; we don't
// need multiple windows.
//
// Bounds are persisted: on second run the window comes back where the
// user left it. We listen on `resize` / `move` and write through a
// debounced settings layer so dragging doesn't hammer the disk. A final
// flush from `main.ts`'s before-quit handler captures the last move
// before exit (without it the very last drag is truncated).

import { BrowserWindow, app, screen } from 'electron'
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

const DEFAULT_BOUNDS: WindowBounds = { width: 1100, height: 720 }
const PRIMARY_WINDOW_SURFACE = {
  windowKey: 'main',
  capabilities: {
    ipcBroadcast: true,
    themeSync: true,
  },
} as const

let primaryWindowCreation: Promise<BrowserWindow> | null = null

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
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    clientNodeLog.error({ validatedURL, errorCode, errorDescription }, 'failed to load')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    clientNodeLog.error({ details }, 'process gone')
  })
  attachClientSurfaceWindow(win, { logLabel: 'window', surface: PRIMARY_WINDOW_SURFACE })
  const { url } = createBrowserEntryUrl({ routePath: '/' })
  allowBrowserWindowEntryUrl(win, url.toString())
  // Plant the auth cookie on the client's session BEFORE
  // `loadURL` so authenticated client requests are ready as
  // soon as the app mounts. The first boot request is public
  // i18n; the auth-gated `useAccessTokenStatus` whoami probe
  // runs after the client entrypoint has hydrated i18n and
  // mounted the app. The window's
  // `webContents.session` is a per-window cookie store in
  // Electron — sharing the default session across windows would
  // leak the cookie into popups. See `cookie-bootstrap.ts` for
  // the full rationale.
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
    detachClientSurfaceWindow(win, PRIMARY_WINDOW_SURFACE)
  })

  try {
    await win.loadURL(url.toString())
  } catch (err) {
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
