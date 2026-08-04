import type { Hono } from 'hono'
import { createApp, type ServerAppOptions } from '#/server/app-factory.ts'
import { stopBackgroundSync } from '#/server/modules/background-sync.ts'
import type { ServerAppRealtimeHost } from '#/server/realtime/app-realtime-host.ts'
import type { PtySupervisor } from '#/server/terminal/pty-supervisor.ts'
import { createServerTerminalRuntime } from '#/server/terminal/terminal-runtime.ts'
import type { ServerWorktreeRemovalHost } from '#/server/worktree-removal/worktree-removal-host.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import type { WorkspaceCapabilityTransitionHost } from '#/server/workspace-capability-transition-host.ts'
import { formatServerUrl } from '#/shared/server-url.ts'

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
      gCommand: options.gCommandEntry
        ? {
            serverUrl: formatServerUrl(options.serverHost, options.serverPort),
            accessToken: options.accessToken,
            entryPath: options.gCommandEntry,
            binDir: options.gCommandBinDir,
            nodePath: options.gCommandNodePath,
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

  const app = createApp({
    version: options.version,
    startedAt: options.startedAt,
    accessToken: options.accessToken,
    ...hosts,
    serverHost: options.serverHost,
    serverPort: options.serverPort,
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
