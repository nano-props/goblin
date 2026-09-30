import type { ClientBridge } from '#/web/bridge/types.ts'
import { createHttpClipboardBackend } from '#/web/clipboard/http-backend.ts'
import { readWebBootstrap } from '#/web/bridge/bootstrap.ts'
import { readClientPageId } from '#/web/bridge/page-id.ts'
import { createClientAppRealtime, type AppRealtimeServerConfig } from '#/web/app/realtime/client.ts'
import { createServerTerminalClient } from '#/web/terminal/server-client.ts'
import { createServerWorkspacePaneTabsClient } from '#/web/workspace-pane/client-tabs.ts'
import { createServerWorkspacePaneRuntimeClient } from '#/web/workspace-pane/client-runtime.ts'
import { createTerminalNotificationProvider } from '#/web/terminal/notification-provider.ts'
import type {
  ClientAppRealtimeLifecycle,
  ClientTerminal,
  ClientWorkspacePaneRuntime,
  ClientWorkspacePaneTabs,
} from '#/web/bridge/types.ts'

function readServerAppRealtimeConfig(): AppRealtimeServerConfig | null {
  // An initial server carries QR bootstrap credentials; other clients use their origin and auth cookie.
  const fromBootstrap = readWebBootstrap().initialServer
  if (fromBootstrap?.url) {
    if (fromBootstrap.accessToken === undefined) throw new Error('Initial server access token is missing')
    return { url: fromBootstrap.url, accessToken: fromBootstrap.accessToken, clientId: readClientPageId() }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return { url: window.location.origin, accessToken: '', clientId: readClientPageId() }
  }
  return null
}

interface ClientServerRealtimeClients {
  appRealtime: ClientAppRealtimeLifecycle
  terminal: ClientTerminal
  workspacePaneTabs: ClientWorkspacePaneTabs
  workspacePaneRuntime: ClientWorkspacePaneRuntime
}

// Realtime feature clients share one stateful WebSocket owner.
let memoizedRealtimeClients: ClientServerRealtimeClients | null = null
function getOrCreateRealtimeClients(): ClientServerRealtimeClients {
  if (memoizedRealtimeClients) return memoizedRealtimeClients
  const appRealtime = createClientAppRealtime({
    getServerConfig() {
      const server = readServerAppRealtimeConfig()
      if (!server) throw new Error('Client app realtime client is unavailable')
      return server
    },
  })
  memoizedRealtimeClients = {
    appRealtime,
    terminal: createServerTerminalClient({
      realtime: appRealtime,
      notificationProvider: createTerminalNotificationProvider(),
    }),
    workspacePaneTabs: createServerWorkspacePaneTabsClient(appRealtime),
    workspacePaneRuntime: createServerWorkspacePaneRuntimeClient(appRealtime),
  }
  return memoizedRealtimeClients
}

function createClientBridge(): ClientBridge {
  const clipboardBackend = (() => {
    const server = readServerAppRealtimeConfig()
    if (!server) return null
    return createHttpClipboardBackend({
      url: server.url,
      accessToken: server.accessToken,
    })
  })()

  const realtimeClients = getOrCreateRealtimeClients()

  return {
    getBootstrap() {
      return readWebBootstrap()
    },
    saveClipboardFiles(files: File[]) {
      if (!clipboardBackend) throw new Error('Clipboard file persistence is unavailable')
      return clipboardBackend.saveClipboardFiles(files)
    },
    appRealtime() {
      return realtimeClients.appRealtime
    },
    terminal() {
      return realtimeClients.terminal
    },
    workspacePaneTabs() {
      return realtimeClients.workspacePaneTabs
    },
    workspacePaneRuntime() {
      return realtimeClients.workspacePaneRuntime
    },
  }
}

// Stateful realtime clients remain shared across feature adapters.
export function getClientBridge(): ClientBridge {
  if (testOverride) return testOverride
  return createClientBridge()
}

let testOverride: ClientBridge | null = null
export function setClientBridgeForTests(bridge: ClientBridge | null): void {
  testOverride = bridge
}
