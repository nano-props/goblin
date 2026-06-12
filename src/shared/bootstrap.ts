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
  secret: string
  clientId?: string
}

export interface RendererRuntimeSnapshot {
  kind: RendererRuntimeKind
  bridgeVersion: number
  capabilities: readonly RendererNativeCapability[]
}

export interface RendererBootstrapPayload {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  i18n: I18nSnapshot
  settings: InitialSettingsSnapshot
  server: InitialServerSnapshot | null
}

export interface RendererBootstrapSnapshot {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  initialI18n: I18nSnapshot | null
  initialSettings: InitialSettingsSnapshot | null
  initialServer: InitialServerSnapshot | null
}
