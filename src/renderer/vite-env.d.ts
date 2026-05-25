/// <reference types="vite/client" />

import type { RpcEvent, RpcRequest } from '#/shared/rpc.ts'
import type {
  TerminalExitEvent,
  TerminalMutationResult,
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
  invokeRpc: (request: RpcRequest) => Promise<unknown>
  abortRpc: (requestId: string) => Promise<boolean>
  onEvent: (cb: (event: RpcEvent) => void) => () => void
  pathForFile: (file: File) => string
  terminal: {
    open: (input: TerminalOpenInput) => Promise<TerminalOpenResult>
    restart: (input: TerminalRestartInput) => Promise<TerminalOpenResult>
    write: (input: TerminalWriteInput) => Promise<TerminalMutationResult>
    resize: (input: TerminalResizeInput) => Promise<TerminalMutationResult>
    close: (input: TerminalSessionInput) => Promise<TerminalMutationResult>
    pruneRepo: (input: TerminalPruneRepoInput) => Promise<TerminalMutationResult>
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
   *  build host has no git available; SettingsPanel hides it then. */
  const __BUILD_INFO__: {
    commit: string
  }
}

export {}
