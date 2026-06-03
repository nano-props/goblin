/// <reference types="vite/client" />

import type {
  InitialI18nSnapshot,
  InitialServerSnapshot,
  InitialSettingsSnapshot,
  RendererBootstrapSnapshot,
} from '#/shared/bootstrap.ts'
import type { RpcEvent, RpcRequest, SettingsPage } from '#/shared/rpc.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { TerminalMutationResult, TerminalNotifyBellInput } from '#/shared/terminal.ts'

interface GoblinBridge {
  homeDir: string
  initialI18n: InitialI18nSnapshot | null
  initialSettings: InitialSettingsSnapshot | null
  initialServer: InitialServerSnapshot | null
  invokeRpc: (request: RpcRequest) => Promise<unknown>
  abortRpc: (requestId: string) => Promise<boolean>
  onEvent: (cb: (event: RpcEvent) => void) => () => void
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
    goblin: GoblinBridge
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
