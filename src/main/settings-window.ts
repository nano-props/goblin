import { BrowserWindow } from 'electron'
import { t } from '#/main/i18n/index.ts'
import {
  macTrafficLightPosition,
  standaloneTitleBarStyle,
  supportsTitleBarOverlay,
  titleBarOverlayForTheme,
} from '#/main/window-chrome.ts'
import { createStandalonePageWindow } from '#/main/standalone-page-window.ts'
import {
  allowRendererWindowEntryUrl,
  createRendererEntryUrl,
  createRendererWindowWebPreferences,
  windowCanvasBackground,
} from '#/main/window-shell.ts'
import { getTheme } from '#/main/theme.ts'
import { SETTINGS_WINDOW_TOP_INSET_PX } from '#/shared/settings-window.ts'
import type { SettingsPage } from '#/shared/rpc.ts'

const settingsWindowController = createStandalonePageWindow<SettingsPage>({
  surface: {
    kind: 'aux',
    windowKey: 'settings',
    capabilities: {
      lifecycle: true,
      rpcBroadcast: true,
      themeSync: true,
      pageRouting: true,
    },
  },
  logLabel: 'settings-window',
  defaultPage: 'general',
  createWindow: async () => {
    const { resolved, colorTheme } = getTheme()
    const win = new BrowserWindow({
      width: 760,
      height: 560,
      minWidth: 640,
      minHeight: 480,
      title: t('settings.title'),
      backgroundColor: windowCanvasBackground(),
      show: false,
      titleBarStyle: standaloneTitleBarStyle(),
      titleBarOverlay: titleBarOverlayForTheme(resolved, colorTheme, SETTINGS_WINDOW_TOP_INSET_PX),
      trafficLightPosition: macTrafficLightPosition(SETTINGS_WINDOW_TOP_INSET_PX),
      autoHideMenuBar: process.platform !== 'darwin',
      webPreferences: await createRendererWindowWebPreferences(),
    })
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    return win
  },
  loadWindow: async (win, page) => {
    const { url } = createRendererEntryUrl({ entryHtml: 'settings.html', hash: page })
    allowRendererWindowEntryUrl(win, url.toString())
    try {
      await win.loadURL(url.toString())
    } catch (err) {
      console.warn('[settings-window] failed to load app URL', err)
    }
  },
  lifecycle: {
    flushOnClose: true,
    onFlushResult: (result) => {
      if (!result.ok) console.warn('[settings-window] flush reported errors', result.errors)
    },
  },
})

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindowController.getWindow()
}

export function isSettingsWindowOpen(): boolean {
  return settingsWindowController.isOpen()
}

export async function openSettingsWindow(page: SettingsPage = 'general'): Promise<BrowserWindow> {
  return settingsWindowController.openWindow(page)
}

export function closeSettingsWindow(): Promise<void> {
  return settingsWindowController.closeWindow()
}

export function applySettingsWindowChromeTheme(theme: 'light' | 'dark'): void {
  if (!supportsTitleBarOverlay()) return
  const win = getSettingsWindow()
  if (!win || win.isDestroyed()) return
  const overlay = titleBarOverlayForTheme(theme, getTheme().colorTheme, SETTINGS_WINDOW_TOP_INSET_PX)
  if (!overlay) return
  try {
    win.setTitleBarOverlay(overlay)
  } catch {}
}
