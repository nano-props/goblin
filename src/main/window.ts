// Single BrowserWindow. Multi-repo lives as tabs inside it; we don't
// need multiple windows.
//
// Bounds are persisted: on second run the window comes back where the
// user left it. We listen on `resize` / `move` and write through a
// debounced settings layer so dragging doesn't hammer the disk. A final
// flush from `main.ts`'s before-quit handler captures the last move
// before exit (without it the very last drag is truncated).

import { BrowserWindow, app, screen } from 'electron'
import { loadWindowState, setWindowBounds, type WindowBounds } from '#/main/window-state.ts'
import { attachRendererSurfaceWindow, detachRendererSurfaceWindow } from '#/main/renderer-surface.ts'
import { defaultTitleBarStyle, macTrafficLightPosition, supportsTitleBarOverlay, titleBarOverlayForTheme } from '#/main/window-chrome.ts'
import { getMainWindow as getRegisteredMainWindow } from '#/main/window-registry.ts'
import {
  allowRendererWindowEntryUrl,
  createRendererEntryUrl,
  createRendererWindowWebPreferences,
  windowCanvasBackground,
} from '#/main/window-shell.ts'
import { getTheme } from '#/main/theme.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

const DEFAULT_BOUNDS: WindowBounds = { width: 1200, height: 760 }
const MAIN_WINDOW_SURFACE = {
  windowKey: 'main',
  capabilities: {
    rpcBroadcast: true,
    themeSync: true,
  },
} as const

let mainWindowCreation: Promise<BrowserWindow> | null = null

export function getMainWindow(): BrowserWindow | null {
  return getRegisteredMainWindow()
}

export function getOrCreateMainWindow(): Promise<BrowserWindow> {
  const existing = getMainWindow()
  if (existing) return Promise.resolve(existing)
  mainWindowCreation ??= createMainWindow().finally(() => {
    mainWindowCreation = null
  })
  return mainWindowCreation
}

export async function activateMainWindow(): Promise<BrowserWindow> {
  await app.whenReady()
  const win = await getOrCreateMainWindow()
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

async function createMainWindow(): Promise<BrowserWindow> {
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
    titleBarOverlay: titleBarOverlayForTheme(resolved, colorTheme, WINDOW_TOPBAR_HEIGHT_PX),
    trafficLightPosition: macTrafficLightPosition(WINDOW_TOPBAR_HEIGHT_PX),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: await createRendererWindowWebPreferences(),
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone', details)
  })
  attachRendererSurfaceWindow(win, { logLabel: 'window', surface: MAIN_WINDOW_SURFACE })
  const { url } = createRendererEntryUrl({ routePath: '/' })
  allowRendererWindowEntryUrl(win, url.toString())
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
    detachRendererSurfaceWindow(win, MAIN_WINDOW_SURFACE)
  })

  try {
    await win.loadURL(url.toString())
  } catch (err) {
    console.warn('[window] failed to load app URL', err)
  }
  return win
}

export function applyMainWindowChromeTheme(theme: 'light' | 'dark'): void {
  if (!supportsTitleBarOverlay()) return
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  const overlay = titleBarOverlayForTheme(theme, getTheme().colorTheme, WINDOW_TOPBAR_HEIGHT_PX)
  if (!overlay) return
  try {
    win.setTitleBarOverlay(overlay)
  } catch {}
}
