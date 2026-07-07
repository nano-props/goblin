import type { Hono } from 'hono'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'

export interface ServerRuntimeOptions extends Omit<ServerAppOptions, 'appRealtimeHost' | 'serverHost' | 'serverPort'> {
  appRealtimeHost?: ServerAppRealtimeHost
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
  appRealtimeHost: ServerAppRealtimeHost
  shutdown(): void
}

export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const {
    appRealtimeHost: providedAppRealtimeHost,
    ptyWorkerEntry,
    gCommandEntry,
    gCommandBinDir,
    gCommandNodePath,
    serverHost,
    serverPort,
    ...appOptions
  } = options
  const runtime = providedAppRealtimeHost
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
  const appRealtimeHost = providedAppRealtimeHost ?? (runtime?.host as ServerAppRealtimeHost)
  // `appOptions` carries `accessToken` (renamed from the pre-PR
  // `internalSecret`); it's forwarded straight to `createApp`.
  const app = createApp({ ...appOptions, appRealtimeHost, serverHost, serverPort })
  let stopped = false
  return {
    app,
    appRealtimeHost,
    shutdown() {
      if (stopped) return
      stopped = true
      stopBackgroundSync()
      if (runtime) {
        runtime.shutdown()
      } else {
        appRealtimeHost.shutdown()
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
