// Shared shell policy for trusted renderer windows.
//
// Boundary:
// - This module owns BrowserWindow shell concerns: preload, security
//   options, trusted entry URL normalization, navigation blocking, and
//   external link handling.
// - It does NOT own surface identity/capabilities; that lives in
//   window-registry.ts / renderer-surface.ts.

import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openHttpExternal } from '#/main/external-url.ts'
import { windowNodeLog } from '#/node/logger.ts'
import {
  allowTrustedAppUrlForWebContents,
  isTrustedAppUrlForWebContents,
  registerTrustedAppUrl,
} from '#/main/ipc/trusted-webcontents.ts'
import { getTheme } from '#/main/theme.ts'
import { getEmbeddedServerRuntime } from '#/main/server-manager.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import { DEFAULT_COLOR_THEME } from '#/shared/settings-defaults.ts'

const webDevUrl = process.env.GOBLIN_WEB_DEV_URL?.trim()
const WEB_DIST_DIR = path.join(app.getAppPath(), 'dist/web')
const PRELOAD_SOURCE_PATH = path.join(app.getAppPath(), 'src/preload/preload.cjs')
const PRELOAD_DIST_DIR = path.join(app.getAppPath(), 'dist/preload')
const PRELOAD_MANIFEST_PATH = path.join(PRELOAD_DIST_DIR, 'manifest.json')

export function windowCanvasBackground(): string {
  const { resolved, colorTheme } = getTheme()
  return WINDOW_BACKGROUND_BY_COLOR_THEME[colorTheme][resolved]
}

export async function createRendererWindowWebPreferences(): Promise<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload: resolvePreloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  }
}

function resolvePreloadPath(): string {
  if (!app.isPackaged) return PRELOAD_SOURCE_PATH
  const manifest = JSON.parse(readFileSync(PRELOAD_MANIFEST_PATH, 'utf8')) as { file?: unknown }
  if (typeof manifest.file !== 'string' || manifest.file.length === 0) {
    throw new Error('Packaged preload manifest is invalid')
  }
  return path.join(PRELOAD_DIST_DIR, manifest.file)
}

function resolveRendererBuildCacheKey(): string | null {
  if (webDevUrl) return null
  try {
    return createHash('sha256')
      .update(readFileSync(path.join(WEB_DIST_DIR, 'index.html')))
      .digest('hex')
      .slice(0, 12)
  } catch {
    return app.getVersion()
  }
}

interface RendererEntryUrlOptions {
  entryHtml?: string
  routePath?: string
}

export function getRendererBaseUrl(): string | null {
  const runtime = getEmbeddedServerRuntime()
  return webDevUrl || runtime?.url || null
}

export function getEmbeddedServerUrl(): string | null {
  const runtime = getEmbeddedServerRuntime()
  return runtime?.url || null
}

export function createRendererEntryUrl({ entryHtml = 'index.html', routePath = '/' }: RendererEntryUrlOptions): {
  url: URL
} {
  const baseUrl = getRendererBaseUrl()
  if (!baseUrl) {
    throw new Error(
      app.isPackaged
        ? 'Embedded renderer server is unavailable in packaged app mode'
        : `Renderer base URL is unavailable for ${path.join(WEB_DIST_DIR, entryHtml)}`,
    )
  }
  const url = new URL(
    routePath.startsWith('/') ? routePath : `/${routePath}`,
    baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
  )
  const { resolved, colorTheme } = getTheme()
  const rendererBuild = resolveRendererBuildCacheKey()
  if (rendererBuild) url.searchParams.set('appBuild', rendererBuild)
  registerTrustedAppUrl(url.toString())
  url.searchParams.set('theme', resolved)
  url.searchParams.set('colorTheme', colorTheme || DEFAULT_COLOR_THEME)
  return { url }
}

export function configureTrustedRendererWindow(win: BrowserWindow, logLabel: string): void {
  win.webContents.on('will-navigate', (event, nextUrl) => {
    // Renderer windows are expected to stay on their bootstrap entry and
    // route internally via app state / browser-history updates, not
    // arbitrary full-frame navigations. We still allow the exact entry URL
    // that main explicitly bound to this webContents so dev/prod reloads and
    // same-entry refresh remain possible. With the embedded app server +
    // history routing we now trust the app origin, not individual entry
    // files.
    if (!isTrustedAppUrlForWebContents(win.webContents.id, nextUrl)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    void openHttpExternal(nextUrl).catch((err) => {
      // Pre-bound `windowNodeLog` instead of `nodeLogger.child({ tag: logLabel })`
      // so this hot click-path doesn't allocate a fresh child logger per
      // navigation event. `logLabel` is preserved in the signature for
      // future call sites; the only current caller passes `'window'`.
      windowNodeLog.warn({ err }, 'failed to open external window URL')
    })
    return { action: 'deny' }
  })
}

export function allowRendererWindowEntryUrl(win: BrowserWindow, value: string): void {
  // Scope trust per BrowserWindow, not just per app origin. Once Goblin has
  // multiple renderer surfaces, a globally-trusted URL set is too broad.
  allowTrustedAppUrlForWebContents(win.webContents, value)
}
