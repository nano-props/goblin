import type { Hono } from 'hono'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { WorkerBackedTerminalHost } from '#/server/terminal/terminal-worker-host.ts'

export interface ServerRuntimeOptions extends Omit<ServerAppOptions, 'terminalHost'> {
  terminalHost?: ServerTerminalHost
}

export interface ServerRuntime {
  app: Hono
  terminalHost: ServerTerminalHost
  shutdown(): void
}

export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const terminalHost = options.terminalHost ?? new WorkerBackedTerminalHost()
  const app = createApp({ ...options, terminalHost })
  let stopped = false
  return {
    app,
    terminalHost,
    shutdown() {
      if (stopped) return
      stopped = true
      stopBackgroundSync()
      terminalHost.shutdown()
    },
  }
}
