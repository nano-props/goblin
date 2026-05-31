// Shared shell policy for trusted renderer windows.
//
// Boundary:
// - This module owns BrowserWindow shell concerns: preload, security
//   options, trusted entry URL normalization, navigation blocking, and
//   external link handling.
// - It does NOT own surface identity/capabilities; that lives in
//   window-registry.ts / renderer-surface.ts.

import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { openHttpExternal } from '#/main/external-url.ts'
import {
  allowTrustedAppUrlForWebContents,
  isTrustedAppUrlForWebContents,
  registerTrustedAppPath,
  registerTrustedAppUrl,
} from '#/main/ipc/trusted-webcontents.ts'
import { getCurrentLang, getDictionary } from '#/main/i18n/index.ts'
import { getTheme } from '#/main/theme.ts'
import { loadSettings } from '#/main/settings.ts'
import { isGlobalShortcutRegistered } from '#/main/shortcuts.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'

const rendererDevUrl = process.env.GOBLIN_RENDERER_DEV_URL?.trim()
const RENDERER_DIST_DIR = path.join(app.getAppPath(), 'dist/renderer')
const PRELOAD_PATH = path.join(app.getAppPath(), 'src/preload/preload.cjs')

export function windowCanvasBackground(): string {
  const { resolved, colorTheme } = getTheme()
  return WINDOW_BACKGROUND_BY_COLOR_THEME[colorTheme][resolved]
}

function initialI18nArgument(): string {
  const lang = getCurrentLang()
  const dict = getDictionary()
  const payload = Buffer.from(JSON.stringify({ lang, dict })).toString('base64')
  return `--goblin-initial-i18n=${payload}`
}

export async function createRendererWindowWebPreferences(): Promise<BrowserWindowConstructorOptions['webPreferences']> {
  const settings = await loadSettings()
  const settingsPayload = Buffer.from(
    JSON.stringify({
      fetchIntervalSec: settings.fetchIntervalSec,
      terminalNotificationsEnabled: settings.terminalNotificationsEnabled,
      shortcutsDisabled: settings.shortcutsDisabled,
      globalShortcutDisabled: settings.globalShortcutDisabled,
      swapCloseShortcuts: settings.swapCloseShortcuts,
      toggleDetailOnActionBarBlankClick: settings.toggleDetailOnActionBarBlankClick,
      globalShortcut: settings.globalShortcut,
      globalShortcutRegistered: isGlobalShortcutRegistered(),
      terminalApp: settings.terminalApp,
      editorApp: settings.editorApp,
    }),
  ).toString('base64')
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    additionalArguments: [
      `--goblin-home-dir=${os.homedir()}`,
      initialI18nArgument(),
      `--goblin-initial-settings=${settingsPayload}`,
    ],
  }
}

interface RendererEntryUrlOptions {
  entryHtml: string
  hash?: string
}

export function createRendererEntryUrl({ entryHtml, hash }: RendererEntryUrlOptions): { url: URL; filePath: string } {
  const filePath = path.join(RENDERER_DIST_DIR, entryHtml)
  const url = rendererDevUrl
    ? new URL(entryHtml, rendererDevUrl.endsWith('/') ? rendererDevUrl : `${rendererDevUrl}/`)
    : pathToFileURL(filePath)
  const { resolved, colorTheme } = getTheme()
  if (rendererDevUrl) registerTrustedAppUrl(url.toString())
  else registerTrustedAppPath(filePath)
  url.searchParams.set('theme', resolved)
  url.searchParams.set('colorTheme', colorTheme)
  if (hash) url.hash = hash
  return { url, filePath }
}

export function configureTrustedRendererWindow(win: BrowserWindow, logLabel: string): void {
  win.webContents.on('will-navigate', (event, nextUrl) => {
    // Renderer windows are expected to stay on their bootstrap entry and
    // route internally via app state / hash updates, not full-frame
    // navigations. We still allow the exact entry URL that main explicitly
    // bound to this webContents so dev/prod reloads and same-entry refresh
    // remain possible, but any cross-entry hop (for example main -> settings)
    // is blocked here and again at IPC trust time.
    if (!isTrustedAppUrlForWebContents(win.webContents.id, nextUrl)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    void openHttpExternal(nextUrl).catch((err) => {
      console.warn(`[${logLabel}] failed to open external window URL`, err)
    })
    return { action: 'deny' }
  })
}

export function allowRendererWindowEntryUrl(win: BrowserWindow, value: string): void {
  // Scope trust per BrowserWindow, not just per app origin. Once Goblin has
  // multiple renderer entries, a globally-trusted URL set is too broad: a
  // main window should not automatically inherit trust to settings.html, and
  // vice versa.
  allowTrustedAppUrlForWebContents(win.webContents, value)
}
