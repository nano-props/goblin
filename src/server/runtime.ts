import type { Hono } from 'hono'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import { createInProcessPtySupervisor } from '#/server/terminal/pty-supervisor-inprocess.ts'
import { WorkerBackedPtySupervisor } from '#/server/terminal/pty-supervisor-worker.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

interface ServerRuntimeBaseOptions extends Omit<
  ServerAppOptions,
  'appRealtimeHost' | 'workspacePaneTabsHost' | 'worktreeRemovalApplication' | 'serverHost' | 'serverPort'
> {
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

interface ServerRuntimeInjectedHosts {
  appRealtimeHost: ServerAppRealtimeHost
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  worktreeRemovalApplication: ServerWorktreeRemovalHost
}

type ServerRuntimeManagedHosts = Partial<Record<keyof ServerRuntimeInjectedHosts, never>>

export type ServerRuntimeOptions = ServerRuntimeBaseOptions & (ServerRuntimeManagedHosts | ServerRuntimeInjectedHosts)

export interface ServerRuntime {
  app: Hono
  appRealtimeHost: ServerAppRealtimeHost
  shutdown(): void
}

function isServerRuntimeInjectedHosts(options: ServerRuntimeOptions): options is ServerRuntimeBaseOptions & ServerRuntimeInjectedHosts {
  return (
    options.appRealtimeHost !== undefined &&
    options.workspacePaneTabsHost !== undefined &&
    options.worktreeRemovalApplication !== undefined
  )
}

function hasAnyServerRuntimeInjectedHost(options: ServerRuntimeOptions): boolean {
  return (
    options.appRealtimeHost !== undefined ||
    options.workspacePaneTabsHost !== undefined ||
    options.worktreeRemovalApplication !== undefined
  )
}

export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const {
    appRealtimeHost: _appRealtimeHost,
    workspacePaneTabsHost: _workspacePaneTabsHost,
    worktreeRemovalApplication: _worktreeRemovalApplication,
    ptyWorkerEntry,
    gCommandEntry,
    gCommandBinDir,
    gCommandNodePath,
    serverHost,
    serverPort,
    ...appOptions
  } = options
  const injectedHosts = isServerRuntimeInjectedHosts(options)
    ? {
        appRealtimeHost: options.appRealtimeHost,
        workspacePaneTabsHost: options.workspacePaneTabsHost,
        worktreeRemovalApplication: options.worktreeRemovalApplication,
      }
    : null
  if (!injectedHosts && hasAnyServerRuntimeInjectedHost(options)) {
    throw new Error('server runtime host injection must include all hosts')
  }

  let terminalRuntime: ReturnType<typeof createServerTerminalRuntime> | null = null
  const hosts = injectedHosts ?? (() => {
    terminalRuntime = createServerTerminalRuntime({
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
    return {
      appRealtimeHost: terminalRuntime.host as ServerAppRealtimeHost,
      workspacePaneTabsHost: terminalRuntime.workspacePaneTabsHost,
      worktreeRemovalApplication: terminalRuntime.worktreeRemovalApplication,
    }
  })()

  // `appOptions` carries `accessToken` (renamed from the pre-PR
  // `internalSecret`); it's forwarded straight to `createApp`.
  const app = createApp({
    ...appOptions,
    ...hosts,
    serverHost,
    serverPort,
  })
  let stopped = false
  return {
    app,
    appRealtimeHost: hosts.appRealtimeHost,
    shutdown() {
      if (stopped) return
      stopped = true
      stopBackgroundSync()
      if (terminalRuntime) {
        terminalRuntime.shutdown()
      } else {
        hosts.appRealtimeHost.shutdown()
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
