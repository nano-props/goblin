/// <reference types="vite/client" />

import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'

declare global {
  interface Window {
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
