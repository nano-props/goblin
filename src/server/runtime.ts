import type { Hono } from 'hono'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'

export interface ServerRuntimeOptions extends Omit<ServerAppOptions, 'terminalHost' | 'serverHost' | 'serverPort'> {
  terminalHost?: ServerTerminalHost
  /**
   * On-disk path of the bundled PTY worker entry. When provided, the
   * runtime uses a dedicated subprocess for node-pty work, so a PTY
   * crash never tears down the native host. When omitted the runtime
   * hosts PTY sessions in-process (cheap, useful for tests).
   */
  ptyWorkerEntry?: string
  gCommandEntry?: string
  gCommandBinDir?: string
  gCommandNodePath?: string
  serverHost: string
  serverPort: number
}

export interface ServerRuntime {
  app: Hono
  terminalHost: ServerTerminalHost
  shutdown(): void
}

export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const {
    terminalHost: providedTerminalHost,
    ptyWorkerEntry,
    gCommandEntry,
    gCommandBinDir,
    gCommandNodePath,
    serverHost,
    serverPort,
    ...appOptions
  } = options
  const runtime = providedTerminalHost
    ? null
    : createServerTerminalRuntime({
        ptySupervisor: ptyWorkerEntry
          ? new WorkerBackedPtySupervisor({ workerEntry: ptyWorkerEntry })
          : createInProcessPtySupervisor(),
        gCommand: gCommandEntry
          ? {
              serverUrl: embeddedServerUrl(serverHost, serverPort),
              accessToken: appOptions.accessToken,
              entryPath: gCommandEntry,
              binDir: gCommandBinDir,
              nodePath: gCommandNodePath,
            }
          : undefined,
      })
  const terminalHost = providedTerminalHost ?? (runtime?.host as ServerTerminalHost)
  // `appOptions` carries `accessToken` (renamed from the pre-PR
  // `internalSecret`); it's forwarded straight to `createApp`.
  const app = createApp({ ...appOptions, terminalHost, serverHost, serverPort })
  let stopped = false
  return {
    app,
    terminalHost,
    shutdown() {
      if (stopped) return
      stopped = true
      stopBackgroundSync()
      if (runtime) {
        runtime.shutdown()
      } else {
        terminalHost.shutdown()
      }
    },
  }
}

function embeddedServerUrl(host: string, port: number): string {
  let accessHost = host
  if (accessHost === '0.0.0.0') accessHost = '127.0.0.1'
  else if (accessHost === '::') accessHost = '[::1]'
  else if (accessHost.includes(':') && !accessHost.startsWith('[')) accessHost = `[${accessHost}]`
  return `http://${accessHost}:${port}`
}
