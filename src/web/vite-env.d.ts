/// <reference types="vite/client" />

import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import type { GoblinNativeBridge } from '#/shared/goblin-native-bridge.ts'

/**
 * The client's view of the Electron preload's `contextBridge` surface.
 * The preload is now a strict IPC bridge — the bootstrap snapshot
 * (`window.__GOBLIN_BOOTSTRAP__`) carries the initial server handoff,
 * and the preload only exposes the methods below.
 */
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
