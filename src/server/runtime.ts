import type { Hono } from 'hono'
import { omit } from 'es-toolkit'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import type { PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'

interface ServerRuntimeBaseOptions extends Omit<
  ServerAppOptions,
  | 'appRealtimeHost'
  | 'workspacePaneTabsHost'
  | 'worktreeRemovalApplication'
  | 'workspaceCapabilityTransitionHost'
  | 'serverHost'
  | 'serverPort'
> {
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
  workspaceCapabilityTransitionHost: WorkspaceCapabilityTransitionHost
}

interface ServerRuntimeManagedHosts extends Partial<Record<keyof ServerRuntimeInjectedHosts, never>> {
  ptySupervisor: PtySupervisor
}

interface ServerRuntimeExternallyManagedHosts extends ServerRuntimeInjectedHosts {
  ptySupervisor?: never
}

export type ServerRuntimeOptions = ServerRuntimeBaseOptions &
  (ServerRuntimeManagedHosts | ServerRuntimeExternallyManagedHosts)

export interface ServerRuntime {
  app: Hono
  appRealtimeHost: ServerAppRealtimeHost
  shutdown(): void
}

function isServerRuntimeInjectedHosts(
  options: ServerRuntimeOptions,
): options is ServerRuntimeBaseOptions & ServerRuntimeExternallyManagedHosts {
  return (
    options.appRealtimeHost !== undefined &&
    options.workspacePaneTabsHost !== undefined &&
    options.worktreeRemovalApplication !== undefined &&
    options.workspaceCapabilityTransitionHost !== undefined
  )
}

function hasAnyServerRuntimeInjectedHost(options: ServerRuntimeOptions): boolean {
  return (
    options.appRealtimeHost !== undefined ||
    options.workspacePaneTabsHost !== undefined ||
    options.worktreeRemovalApplication !== undefined ||
    options.workspaceCapabilityTransitionHost !== undefined
  )
}

export function createServerRuntime(options: ServerRuntimeOptions): ServerRuntime {
  const appRuntimeOptions = omit(options, [
    'appRealtimeHost',
    'workspacePaneTabsHost',
    'worktreeRemovalApplication',
    'workspaceCapabilityTransitionHost',
    'ptySupervisor',
  ])
  const { gCommandEntry, gCommandBinDir, gCommandNodePath, serverHost, serverPort, ...appOptions } = appRuntimeOptions

  let terminalRuntime: ReturnType<typeof createServerTerminalRuntime> | null = null
  let hosts: ServerRuntimeInjectedHosts
  if (isServerRuntimeInjectedHosts(options)) {
    hosts = {
      appRealtimeHost: options.appRealtimeHost,
      workspacePaneTabsHost: options.workspacePaneTabsHost,
      worktreeRemovalApplication: options.worktreeRemovalApplication,
      workspaceCapabilityTransitionHost: options.workspaceCapabilityTransitionHost,
    }
  } else {
    if (hasAnyServerRuntimeInjectedHost(options)) {
      throw new Error('server runtime host injection must include all hosts')
    }
    terminalRuntime = createServerTerminalRuntime({
      ptySupervisor: options.ptySupervisor,
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
    hosts = {
      appRealtimeHost: terminalRuntime.host,
      workspacePaneTabsHost: terminalRuntime.workspacePaneTabsHost,
      worktreeRemovalApplication: terminalRuntime.worktreeRemovalApplication,
      workspaceCapabilityTransitionHost: terminalRuntime.workspaceCapabilityTransitionHost,
    }
  }

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
