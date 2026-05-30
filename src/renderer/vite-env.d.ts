/// <reference types="vite/client" />

import type { RpcEvent, RpcRequest, SettingsPage } from '#/shared/rpc.ts'
import type { WindowFlushResult } from '#/shared/window-lifecycle.ts'
import type {
  TerminalExitEvent,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOpenInput,
  TerminalOpenResult,
  TerminalOutputEvent,
  TerminalPruneRepoInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalWriteInput,
} from '#/shared/terminal.ts'

interface GoblinBridge {
  homeDir: string
  initialI18n: { lang: string; dict: Record<string, string> } | null
  invokeRpc: (request: RpcRequest) => Promise<unknown>
  abortRpc: (requestId: string) => Promise<boolean>
  onEvent: (cb: (event: RpcEvent) => void) => () => void
  onWindowPageSet?: (windowKey: string, cb: (page: SettingsPage | string) => void) => () => void
  notifyWindowReady?: (windowKey: string) => void
  onWindowFlushRequest?: (windowKey: string, cb: (requestId: string) => Promise<WindowFlushResult> | WindowFlushResult) => () => void
  pathForFile: (file: File) => string
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalOpenResult>
    restart: (input: TerminalRestartInput) => Promise<TerminalOpenResult>
    write: (input: TerminalWriteInput) => Promise<TerminalMutationResult>
    resize: (input: TerminalResizeInput) => Promise<TerminalMutationResult>
    close: (input: TerminalSessionInput) => Promise<TerminalMutationResult>
    pruneRepo: (input: TerminalPruneRepoInput) => Promise<TerminalMutationResult>
    notifyBell: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
    sendTestNotification: () => Promise<boolean>
    setBadge: (count: number) => void
    onOutput: (cb: (event: TerminalOutputEvent) => void) => () => void
    onExit: (cb: (event: TerminalExitEvent) => void) => () => void
  }
}

declare global {
  interface Window {
    goblin: GoblinBridge
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
