import type { EditorPref, I18nSnapshot, TerminalPref } from '#/shared/api-types.ts'

export type RendererRuntimeKind = 'electron' | 'web'
export type RendererNativeCapability =
  | 'settings-ipc'
  | 'open-settings-window'
  | 'open-external-url'
  | 'open-directory-dialog'
  | 'consume-external-open-paths'
  | 'open-in-finder'
  | 'terminal-notifications'
  | 'terminal-badge'

export const RENDERER_BRIDGE_VERSION = 1
export const ELECTRON_RENDERER_CAPABILITIES = [
  'settings-ipc',
  'open-settings-window',
  'open-external-url',
  'open-directory-dialog',
  'consume-external-open-paths',
  'open-in-finder',
  'terminal-notifications',
  'terminal-badge',
] as const satisfies readonly RendererNativeCapability[]
export const WEB_RENDERER_CAPABILITIES = [] as const satisfies readonly RendererNativeCapability[]

export interface InitialSettingsSnapshot {
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  toggleDetailOnActionBarBlankClick: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  terminalApp: TerminalPref
  editorApp: EditorPref
  lanEnabled: boolean
}

export interface InitialServerSnapshot {
  url: string
  /**
   * Access token, inlined into the bootstrap only when the server is
   * running in a context where the browser / renderer can't otherwise
   * obtain it:
   *  - the embedded Electron renderer (server spawned by main with
   *    `GOBLIN_EMBEDDED_RUNTIME=1`)
   *  - the Vite dev server (`GOBLIN_DEV_BOOTSTRAP_INCLUDES_TOKEN=1`)
   *
   * In standalone `serve.sh` mode neither flag is set, the field is
   * absent, and the renderer must go through `POST /api/login` to
   * set the http-only cookie.
   */
  accessToken?: string
  /**
   * Reserved for legacy back-compat; new code should not read this.
   * The renderer now generates its own client id at runtime; the
   * server no longer derives one from the access token.
   */
  clientId?: string
}

export interface RendererRuntimeSnapshot {
  kind: RendererRuntimeKind
  bridgeVersion: number
  capabilities: readonly RendererNativeCapability[]
}

/**
 * The host platform the renderer is running on. Exposed in the bootstrap
 * payload so renderer code can branch on OS without reaching for
 * `process.platform` (the renderer is sandboxed and does not have
 * `process` at runtime). 'web' is the fallback when no host platform is
 * available, e.g. the renderer is running outside Electron.
 */
export type RendererPlatform = NodeJS.Platform | 'web'

export interface RendererBootstrapPayload {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  platform: RendererPlatform
  i18n: I18nSnapshot
  settings: InitialSettingsSnapshot
  server: InitialServerSnapshot | null
}

export interface RendererBootstrapSnapshot {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  platform: RendererPlatform
  initialI18n: I18nSnapshot | null
  initialSettings: InitialSettingsSnapshot | null
  initialServer: InitialServerSnapshot | null
}
