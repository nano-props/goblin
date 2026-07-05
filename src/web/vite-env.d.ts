/// <reference types="vite/client" />

import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest, SettingsPage } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { AppQuitDrainResult } from '#/shared/app-quit-drain.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type {
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalTestNotificationInput,
} from '#/shared/terminal-types.ts'

/**
 * The client's view of the Electron preload's `contextBridge` surface.
 * The preload is now a strict IPC bridge — the bootstrap snapshot
 * (`window.__GOBLIN_BOOTSTRAP__`) carries the initial server handoff,
 * and the preload only exposes the methods below.
 */
interface GoblinNativeBridge {
  invokeIpc: (request: IpcRequest) => Promise<unknown>
  abortIpc: (requestId: string) => Promise<boolean>
  notifyAppQuitDrained?: (result: AppQuitDrainResult) => Promise<boolean>
  onEvent: (cb: (event: IpcEvent) => void) => () => void
  onIntent?: (cb: (event: ClientEffectIntent) => void) => () => void
  pathForFile: (file: File) => string
  host?: {
    openSettingsWindow: (input?: { page?: SettingsPage }) => Promise<boolean>
    openExternalUrl: (input: { url: string; allowHttp?: boolean }) => Promise<ExecResult>
    openDirectoryDialog: (input?: { title?: string }) => Promise<string | null>
    consumeExternalOpenPaths: () => Promise<string[]>
  }
  terminal: {
    // Methods are typed as optional to reflect the fact that an
    // older preload (or a non-Electron runtime that for some
    // reason still exposes `goblinNative` without the full
    // surface) may omit one or more of them. The client-side
    // `capabilitiesFromBridge` projects these into capability
    // flags so the UI can hide controls the bridge can't satisfy.
    notifyBell?: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
    sendTestNotification?: (input: TerminalTestNotificationInput) => Promise<boolean>
    setBadge?: (count: number) => void
  }
  /**
   * Persist clipboard / drop file blobs through the native host.
   * Always returns `[]` on failure (preload swallows errors); callers
   * should treat an empty result as "no blob made it across" and count
   * backend transfer failures separately from unsafe path filtering.
   */
  saveClipboardFiles: (files: File[]) => Promise<string[]>
  /**
   * Electron-only: invalidate the current access token, restart the
   * embedded server, and return the freshly-generated token. The
   * client surfaces the new value in the Web settings page so the
   * user can re-authenticate. Older preloads (or non-Electron
   * clients) leave this method undefined; the Web settings page
   * gates the rotate button on the runtime kind, not on this
   * method's presence, but the optional type lets the call site
   * typecheck.
   */
  rotateAccessToken?: () => Promise<{ accessToken: string }>
}

declare global {
  interface Window {
    goblinNative: GoblinNativeBridge
    __GOBLIN_BOOTSTRAP__?: ClientBootstrapSnapshot
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
