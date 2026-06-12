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
import { openHttpExternal } from '#/main/external-url.ts'
import {
  allowTrustedAppUrlForWebContents,
  isTrustedAppUrlForWebContents,
  registerTrustedAppUrl,
} from '#/main/ipc/trusted-webcontents.ts'
import { getCurrentLang } from '#/main/i18n/index.ts'
import { getTheme } from '#/main/theme.ts'
import { getEmbeddedServerRuntime } from '#/main/server-manager.ts'
import { getSettingsSnapshot } from '#/main/settings-server-client.ts'
import type { InitialSettingsSnapshot, RendererBootstrapPayload } from '#/shared/bootstrap.ts'
import { ELECTRON_RENDERER_CAPABILITIES } from '#/shared/bootstrap.ts'
import {
  createRendererBootstrapPayload,
  createRendererRuntimeSnapshot,
  toInitialServerSnapshot,
} from '#/shared/bootstrap-builders.ts'
import { buildI18nSnapshot } from '#/shared/i18n/snapshot.ts'
import type { LangPref } from '#/shared/api-types.ts'
import { WINDOW_BACKGROUND_BY_COLOR_THEME } from '#/shared/theme-tokens.ts'
import { DEFAULT_COLOR_THEME, initialSettingsFromSnapshot } from '#/shared/settings-defaults.ts'

const webDevUrl = process.env.GOBLIN_WEB_DEV_URL?.trim()
const WEB_DIST_DIR = path.join(app.getAppPath(), 'dist/web')
const PRELOAD_PATH = path.join(app.getAppPath(), 'src/preload/preload.cjs')

export function windowCanvasBackground(): string {
  const { resolved, colorTheme } = getTheme()
  return WINDOW_BACKGROUND_BY_COLOR_THEME[colorTheme][resolved]
}

function buildRendererBootstrapPayload(
  langPref: LangPref,
  initialSettings: InitialSettingsSnapshot,
): RendererBootstrapPayload {
  const runtime = getEmbeddedServerRuntime()
  return createRendererBootstrapPayload({
    runtime: createRendererRuntimeSnapshot('electron', ELECTRON_RENDERER_CAPABILITIES),
    homeDir: os.homedir(),
    i18n: buildI18nSnapshot({ lang: getCurrentLang(), pref: langPref }),
    settings: initialSettings,
    server: toInitialServerSnapshot(runtime ? { ...runtime, url: webDevUrl || runtime.url } : null),
  })
}

export async function createRendererWindowWebPreferences(): Promise<BrowserWindowConstructorOptions['webPreferences']> {
  const settingsSnapshot = await getSettingsSnapshot()
  const initialSettings: InitialSettingsSnapshot = initialSettingsFromSnapshot(settingsSnapshot)
  const bootstrapPayload = Buffer.from(
    JSON.stringify(buildRendererBootstrapPayload(settingsSnapshot.lang, initialSettings)),
  ).toString('base64')
  return {
    preload: PRELOAD_PATH,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    additionalArguments: [`--goblin-bootstrap=${bootstrapPayload}`],
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
      console.warn(`[${logLabel}] failed to open external window URL`, err)
    })
    return { action: 'deny' }
  })
}

export function allowRendererWindowEntryUrl(win: BrowserWindow, value: string): void {
  // Scope trust per BrowserWindow, not just per app origin. Once Goblin has
  // multiple renderer surfaces, a globally-trusted URL set is too broad.
  allowTrustedAppUrlForWebContents(win.webContents, value)
}
