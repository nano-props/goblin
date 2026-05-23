/// <reference types="vite/client" />

import type { RpcEvent, RpcRequest } from '#/shared/rpc.ts'

interface GoblinBridge {
  homeDir: string
  invokeRpc: (request: RpcRequest) => Promise<unknown>
  onEvent: (cb: (event: RpcEvent) => void) => () => void
  pathForFile: (file: File) => string
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
