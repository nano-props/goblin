import type { ClientNativeCapability } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { ClientHostBridge, ClientBridge } from '#/web/client-bridge-types.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { createHttpClipboardBackend } from '#/web/clipboard/http-backend.ts'
import { readWebBootstrap } from '#/web/client-bootstrap-bridge.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { createClientAppRealtime, type AppRealtimeServerConfig } from '#/web/app-realtime-client.ts'
import { createServerTerminalClient } from '#/web/client-terminal.ts'
import { createServerWorkspacePaneTabsClient } from '#/web/client-workspace-pane-tabs.ts'
import { createServerWorkspacePaneRuntimeClient } from '#/web/client-workspace-pane-runtime.ts'
import { createTerminalNotificationProvider } from '#/web/terminal-notification-provider.ts'
import type {
  ClientAppRealtimeLifecycle,
  ClientTerminal,
  ClientWorkspacePaneRuntime,
  ClientWorkspacePaneTabs,
} from '#/web/client-bridge-types.ts'

/** The complete native preload contract exposes this fixed capability set. */
function capabilitiesFromBridge(bridge: NonNullable<Window['goblinNative']>): ReadonlySet<ClientNativeCapability> {
  void bridge
  return new Set<ClientNativeCapability>([
    'global-shortcut',
    'open-settings-window',
    'open-external-url',
    'open-directory-dialog',
    'consume-external-open-paths',
    'terminal-notifications',
    'terminal-badge',
  ])
}

/**
 * Read the server-terminal config from the bootstrap. Shared by the
 * terminal client and the HTTP clipboard backend — both go through
 * the same `window.location.origin` + cookie auth flow, so there is
 * no longer an Electron-specific fork here.
 */
function readServerAppRealtimeConfig(): AppRealtimeServerConfig | null {
  // Two paths can populate the bootstrap's `initialServer`:
  //
  //  - QR-code URL bootstrap (`?accessToken=…`) drops a token on
  //    the URL before first paint; `useAccessTokenStatus` consumes
  //    the token for the cookie.
  //
  // Everything else (Electron embedded, standalone web, Vite-served
  // dev) authenticates via the http-only cookie set by either
  // `plantEmbedAuthCookie` (embedded main, before loadURL) or
  // `POST /api/login` (web). The WS upgrade sends the cookie
  // automatically. We derive the URL from `window.location.origin`
  // and use an empty `accessToken`; the WebSocket helper still
  // serializes that as `?t=`, but the server checks cookie before
  // query token so cookie auth remains the effective channel.
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

// The app realtime client is *expensive*: it owns the shared WebSocket,
// subscriber sets, heartbeat, and recovery hooks. Feature clients are sibling
// capability adapters over that transport.
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

/**
 * The single client bridge. Replaces the previous
 * `electronBridge()` / `webBridge()` pair: there is no longer a
 * runtime-specific factory, just one bridge whose every method
 * reads `window.goblinNative` lazily for genuinely native capabilities.
 *
 * Why this is the right shape:
 *
 *  - The bootstrap is identical across repoOperationSchedulers now (host info and
 *    auth both live on dedicated `/api/*` endpoints). The only
 *    runtime-specific surface is the IPC bridge the Electron
 *    preload exposes under `window.goblinNative` — and that surface
 *    is detected per-call, not per-bridge.
 *
 *  - The previous "two factories" model forced every call site
 *    (`app-shell-client`, `terminal`, `clipboard`) to be aware of
 *    the Electron vs web split. With a single bridge the split is
 *    a property of the bridge's `kind()` and `hasCapability()`
 *    results, not a fork in every call site.
 */
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
      return bridge ? capabilitiesFromBridge(bridge).has(capability) : false
    },
    getBootstrap() {
      // The bridge exposes the current bootstrap source; bootstrap.ts owns
      // the single authoritative capture used by the application.
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
    onIpcEvent(cb: (event: IpcEvent) => void) {
      const bridge = readNativeBridge()
      if (!bridge) return () => {}
      return bridge.onEvent(cb)
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
    async rotateAccessToken() {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Token rotation is unavailable in this runtime')
      return await bridge.rotateAccessToken()
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

// The collapsed bridge is `kind()`-agnostic — every method reads
// `window.goblinNative` lazily, so the same instance handles both
// the Electron-embedded runtime (where `goblinNative` is exposed by
// the preload) and the standalone web runtime (where it isn't).
//
// We rebuild the outer bridge on every call rather than memoizing:
// the inner terminal client is memoized separately (it owns the
// WebSocket and must be a singleton), but everything else — IPC,
// shell, capabilities, clipboard backend, bootstrap — is just a
// closure over the live `goblinNative`. Rebuilding is cheap
// (single closure allocation per access — well under the IPC
// round-trip the bridge is built to support) and means tests (and
// StrictMode double-mounts in dev) can swap the preload between
// phases of an effect without breaking the bridge shape.
export function getClientBridge(): ClientBridge {
  if (testOverride) return testOverride
  return createClientBridge()
}

// Test override. When set to a non-null bridge, every
// `getClientBridge()` call returns that bridge verbatim. When
// cleared back to `null`, the next call rebuilds from the live
// `window.goblinNative`. Production code never touches this.
let testOverride: ClientBridge | null = null
export function setClientBridgeForTests(bridge: ClientBridge | null): void {
  testOverride = bridge
}
