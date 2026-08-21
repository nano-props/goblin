import type { ClientNativeCapability } from '#/shared/bootstrap.ts'
import type { IpcRequest } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ClientHostBridge, ClientBridge } from '#/web/bridge/types.ts'
import { readNativeBridge } from '#/web/bridge/native.ts'
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

const NATIVE_CLIENT_CAPABILITIES: ReadonlySet<ClientNativeCapability> = new Set([
  'global-shortcut',
  'open-settings-window',
  'open-external-url',
  'open-directory-dialog',
  'consume-external-open-paths',
  'terminal-notifications',
  'terminal-badge',
])

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
      setBadge: (count: number) => {
        const bridge = readNativeBridge()
        if (bridge) bridge.terminal.setBadge(count)
      },
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
    kind() {
      return readNativeBridge() ? 'electron' : 'web'
    },
    hasCapability(capability) {
      const bridge = readNativeBridge()
      return bridge ? NATIVE_CLIENT_CAPABILITIES.has(capability) : false
    },
    getBootstrap() {
      return readWebBootstrap()
    },
    invokeIpc(request: IpcRequest) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable in this runtime')
      return bridge.invokeIpc(request)
    },
    async abortIpc(requestId: string) {
      const bridge = readNativeBridge()
      if (!bridge) return false
      return bridge.abortIpc(requestId)
    },
    onEffectIntent(cb: (event: ClientEffectIntent) => void) {
      const bridge = readNativeBridge()
      return bridge ? bridge.onIntent(cb) : () => {}
    },
    pathForFile(file: File) {
      const bridge = readNativeBridge()
      if (!bridge) return ''
      return bridge.pathForFile(file)
    },
    saveClipboardFiles(files: File[]) {
      if (!clipboardBackend) throw new Error('Clipboard file persistence is unavailable')
      return clipboardBackend.saveClipboardFiles(files)
    },
    async getAccessTokenProjection() {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Token projection is unavailable in this runtime')
      return bridge.getAccessTokenProjection()
    },
    async rotateAccessToken() {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Token rotation is unavailable in this runtime')
      return bridge.rotateAccessToken()
    },
    host(): ClientHostBridge | null {
      return readNativeBridge()?.host ?? null
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

// Rebuild stateless adapters from the live native bridge; stateful realtime clients remain shared.
export function getClientBridge(): ClientBridge {
  if (testOverride) return testOverride
  return createClientBridge()
}

let testOverride: ClientBridge | null = null
export function setClientBridgeForTests(bridge: ClientBridge | null): void {
  testOverride = bridge
}
