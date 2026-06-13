/// <reference types="vite/client" />

import type {
  RendererPlatform,
  RendererRuntimeSnapshot,
  InitialServerSnapshot,
  InitialSettingsSnapshot,
  RendererBootstrapSnapshot,
} from '#/shared/bootstrap.ts'
import type { I18nSnapshot, IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { TerminalMutationResult, TerminalNotifyBellInput } from '#/shared/terminal.ts'

interface GoblinNativeBridge {
  runtime: RendererRuntimeSnapshot
  homeDir: string
  /**
   * Host platform the renderer is running on. Mirrors `process.platform`
   * for the Electron main process; the renderer is sandboxed and does
   * not have `process` available, so the preload surfaces this from the
   * bootstrap payload. Defaults to 'web' for the dev server preview.
   */
  platform: RendererPlatform
  initialI18n: I18nSnapshot | null
  initialSettings: InitialSettingsSnapshot | null
  initialServer: InitialServerSnapshot | null
  invokeIpc: (request: IpcRequest) => Promise<unknown>
  abortIpc: (requestId: string) => Promise<boolean>
  onEvent: (cb: (event: IpcEvent) => void) => () => void
  onIntent?: (cb: (event: RendererEffectIntent) => void) => () => void
  pathForFile: (file: File) => string
  shell?: {
    openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
    openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
    openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
    consumeExternalOpenPaths: () => Promise<string[]>
    openInFinder: (input: { path: string }) => Promise<ExecResult>
  }
  terminal: {
    notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
    sendTestNotification: () => Promise<boolean>
    setBadge: (count: number) => void
  }
}

declare global {
  interface Window {
    goblinNative: GoblinNativeBridge
    __GOBLIN_BOOTSTRAP__?: RendererBootstrapSnapshot
  }
  /** Injected by vite.config.ts `define`. */
  const __APP_VERSION__: string
  /** Injected by vite.config.ts `define`. `commit` may be empty if the
   *  build host has no git available; the settings UI hides it then. */
  const __BUILD_INFO__: {
    commit: string
  }
}

export {}
