// Single BrowserWindow. Multi-repo lives as tabs inside it; we don't
// need multiple windows.
//
// Bounds are persisted: on second run the window comes back where the
// user left it. We listen on `resize` / `move` and write through a
// debounced settings layer so dragging doesn't hammer the disk. A final
// flush from `main.ts`'s before-quit handler captures the last move
// before exit (without it the very last drag is truncated).

import { BrowserWindow, app, screen } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getTheme } from '#/main/theme.ts'
import { loadSettings, setWindowBounds, type WindowBounds } from '#/main/settings.ts'
import { closeAllTerminalSessions } from '#/main/terminal.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'

const DEFAULT_BOUNDS: WindowBounds = { width: 1200, height: 760 }

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export async function activateMainWindow(): Promise<BrowserWindow> {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : await createMainWindow()
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

export async function createMainWindow(): Promise<BrowserWindow> {
  const { resolved, colorTheme } = getTheme()
  // Match the renderer's body background so there's no white flash
  // before the bundle loads. Hex values mirror each theme's
  // `--gbl-surface-canvas`.
  const backgroundColor = WINDOW_BACKGROUND_BY_COLOR_THEME[colorTheme][resolved]

  const settings = await loadSettings()
  const saved = settings.windowBounds
  const bounds = saved ? clampToDisplay(saved) : DEFAULT_BOUNDS

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 640,
    minHeight: 480,
    backgroundColor,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'src/preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox the renderer. The preload bridge uses only `electron`
      // (`contextBridge`, `ipcRenderer`, `webUtils`) which is
      // sandbox-compatible — no `fs`/`path` required.
      // Enabling sandbox cuts off Node primitives if `contextIsolation`
      // ever leaks, turning a renderer XSS into something less than
      // arbitrary code execution.
      sandbox: true,
      webSecurity: true,
      // Inject startup-time constants the preload would otherwise need
      // Node modules to resolve. Sandbox forbids `require('os')` in the
      // preload, but `process.argv` is still readable — this is the
      // Electron-recommended way to thread main-process values down.
      additionalArguments: [`--gbl-home-dir=${os.homedir()}`],
    },
  })

  // file:// load so the existing CSP (`script-src 'self'`) stays clean.
  // `?theme=` and `?colorTheme=` let the boot script apply theme attrs
  // before stylesheets load (no flash). `pathToFileURL` handles Windows
  // path/URL conversion (drive letters, backslashes) — interpolating into
  // a `file://` literal string would produce malformed URLs on Win32.
  const url = pathToFileURL(path.join(app.getAppPath(), 'dist/renderer/index.html'))
  url.searchParams.set('theme', resolved)
  url.searchParams.set('colorTheme', colorTheme)
  void win.loadURL(url.toString())

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
    closeAllTerminalSessions()
    if (mainWindow === win) mainWindow = null
  })

  mainWindow = win
  return win
}
