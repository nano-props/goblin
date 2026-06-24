import type { ClientBootstrapSnapshot, ClientNativeCapability } from '#/shared/bootstrap.ts'
import type { IpcEvent, IpcRequest } from '#/shared/api-types.ts'
import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'
import type { RendererShellBridge, RendererBridge, RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { createHttpClipboardBackend } from '#/web/clipboard/http-backend.ts'
import {
  emptyBootstrapSnapshot,
  normalizeRendererServerClientId,
  readWebBootstrap,
} from '#/web/renderer-bootstrap-bridge.ts'
import {
  createServerTerminalBridge,
  readOrCreateWebTerminalClientId,
  type RendererServerTerminalConfig,
} from '#/web/renderer-terminal-bridge.ts'

/**
 * Compute the renderer's capability set from the live `goblinNative`
 * bridge. The capability list is intentionally a *projection* of the
 * preload's exposed methods, not a hard-coded constant — a partial
 * preload (e.g. an older Electron build that hasn't added
 * `openDirectoryDialog` yet) will simply not advertise the missing
 * capabilities, and the renderer's UI gates (`canOpenAppSettings`,
 * `hasNativeDirectoryPicker`, …) will quietly hide themselves.
 *
 * This collapses the previous "static Electron capability list + a
 * separate `electronBridge` factory" into a single source of truth:
 * what the bridge is *capable* of is what the bridge *has*.
 */
function capabilitiesFromBridge(bridge: NonNullable<Window['goblinNative']>): ReadonlySet<ClientNativeCapability> {
  const caps = new Set<ClientNativeCapability>()
  if (typeof bridge.invokeIpc === 'function') caps.add('settings-ipc')
  if (bridge.shell?.openSettingsWindow) caps.add('open-settings-window')
  if (bridge.shell?.openExternalUrl) caps.add('open-external-url')
  if (bridge.shell?.openDirectoryDialog) caps.add('open-directory-dialog')
  if (bridge.shell?.consumeExternalOpenPaths) caps.add('consume-external-open-paths')
  if (bridge.shell?.openInFinder) caps.add('open-in-finder')
  // `terminal` is typed as required on `GoblinNativeBridge` but a
  // test or older preload may omit it; the `?.` keeps the runtime
  // safe without forcing every mock to declare a stub.
  const terminal = bridge.terminal
  if (terminal?.notifyBell || terminal?.sendTestNotification) caps.add('terminal-notifications')
  if (terminal?.setBadge) caps.add('terminal-badge')
  return caps
}

/**
 * Read the server-terminal config from the bootstrap. Shared by the
 * terminal bridge and the HTTP clipboard backend — both go through
 * the same `window.location.origin` + cookie auth flow, so there is
 * no longer an Electron-specific fork here.
 */
function readServerTerminalConfig(): RendererServerTerminalConfig | null {
  // Two paths can populate the bootstrap's `initialServer`:
  //
  //  - QR-code URL bootstrap (`?accessToken=…`) drops a token on
  //    the URL before first paint; `useAccessTokenStatus` consumes
  //    the token for the cookie. The `goblinServerClientId=` query
  //    is still accepted for backward compatibility (older Goblin
  //    builds emitted it) but is now optional — the server derives
  //    its `userId` from the access token, not from `clientId`,
  //    so the cross-browser takeover case no longer needs a
  //    pre-shared `clientId`. See `identity.ts`.
  //
  // Everything else (Electron embedded, standalone web, Vite-served
  // dev) authenticates via the http-only cookie set by either
  // `plantEmbedAuthCookie` (embedded main, before loadURL) or
  // `POST /api/login` (web). The WS upgrade sends the cookie
  // automatically. We derive the URL from `window.location.origin`
  // and use an empty `accessToken` — the WebSocket URL has no
  // `?t=` query in that case.
  const fromBootstrap = readWebBootstrap(readOrCreateWebTerminalClientId).initialServer
  if (fromBootstrap?.url) {
    const clientId = normalizeRendererServerClientId(fromBootstrap.clientId) ?? readOrCreateWebTerminalClientId()
    if (!clientId) return null
    return { url: fromBootstrap.url, accessToken: fromBootstrap.accessToken ?? '', clientId }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const clientId = readOrCreateWebTerminalClientId()
    if (!clientId) return null
    return { url: window.location.origin, accessToken: '', clientId }
  }
  return null
}

// The terminal bridge is *expensive*: it opens a WebSocket, holds
// subscriber sets, and shares state across the whole renderer.
// `terminalBridge` from `#/web/terminal.ts` re-reads `getRendererBridge()`
// on every method call, so we must keep a stable singleton here.
// The bridge's `notifyBell` / `sendTestNotification` / `setBadge`
// callbacks re-read `goblinNative` on each invocation — that's
// the lazy hook that lets the bell-controller tests swap the
// preload between cases without rebuilding the WebSocket layer.
let memoizedTerminalBridge: RendererTerminalBridge | null = null
function getOrCreateTerminalBridge(): RendererTerminalBridge {
  if (memoizedTerminalBridge) return memoizedTerminalBridge
  memoizedTerminalBridge = createServerTerminalBridge({
    getClientId: readOrCreateWebTerminalClientId,
    getServerConfig() {
      const server = readServerTerminalConfig()
      if (!server) throw new Error('Renderer terminal bridge is unavailable')
      return server
    },
    // These callbacks re-read `goblinNative` on every invocation
    // (rather than capturing it at construction time). The
    // underlying server-terminal bridge is a singleton — its
    // WebSocket and subscriber sets must survive across the
    // outer bridge's per-call rebuilds — but `notifyBell` /
    // `sendTestNotification` need to follow the live preload so
    // tests can swap it between cases without rebuilding the
    // WebSocket. Returning `undefined` (not `Promise.resolve(false)`)
    // when no native bridge is present is the *signal* for the
    // server-terminal bridge to fall through to its built-in
    // browser-notification path — collapsing both to `false`
    // would hide that path entirely and break the "web host
    // mode" bell-click test.
    notifyBell: (input) => readNativeBridge()?.terminal?.notifyBell?.(input),
    sendTestNotification: () => readNativeBridge()?.terminal?.sendTestNotification?.(),
    setBadge: (count: number) => {
      readNativeBridge()?.terminal?.setBadge?.(count)
    },
  })
  return memoizedTerminalBridge
}

/**
 * The single renderer bridge. Replaces the previous
 * `electronBridge()` / `webBridge()` pair: there is no longer a
 * runtime-specific factory, just one bridge whose every method
 * reads `window.goblinNative` lazily and falls through to a safe
 * default (throw for IPC, return false for abort, return null for
 * shell, etc.) when the native bridge is absent.
 *
 * Why this is the right shape:
 *
 *  - The bootstrap is identical across runtimes now (host info and
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
function createRendererBridge(): RendererBridge {
  const clipboardBackend = (() => {
    const server = readServerTerminalConfig()
    if (!server) return null
    return createHttpClipboardBackend({
      url: server.url,
      accessToken: server.accessToken ?? '',
    })
  })()

  const terminalBridge = getOrCreateTerminalBridge()

  return {
    kind() {
      return readNativeBridge() ? 'electron' : 'web'
    },
    hasCapability(capability) {
      const bridge = readNativeBridge()
      return bridge ? capabilitiesFromBridge(bridge).has(capability) : false
    },
    getBootstrap() {
      // Read the bootstrap lazily on every call. The web-runtime
      // bootstrap is composed from `window.__GOBLIN_BOOTSTRAP__`,
      // the `<script id="goblin-bootstrap">` tag, and the URL query
      // — all of which can be populated at different times during
      // boot. Eager capture here would lock the first read (often
      // empty) into the bridge and prevent later, more populated
      // reads from being observed by `bootstrap.ts`'s re-read loop.
      return readWebBootstrap(readOrCreateWebTerminalClientId)
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
      return bridge?.onIntent?.(cb) ?? (() => {})
    },
    pathForFile(file: File) {
      const bridge = readNativeBridge()
      if (!bridge) return ''
      return bridge.pathForFile(file)
    },
    saveClipboardFiles(files: File[]) {
      // Native bridge takes precedence (Electron writes under
      // `<os.tmpdir>/goblin-clipboard-<pid>/`). The HTTP backend is
      // the web fallback. A native preload that hasn't been
      // upgraded to expose `saveClipboardFiles` (older versions)
      // collapses to the HTTP backend instead of throwing.
      const bridge = readNativeBridge()
      if (bridge && typeof bridge.saveClipboardFiles === 'function') {
        return bridge.saveClipboardFiles(files)
      }
      if (!clipboardBackend) return Promise.resolve([])
      return clipboardBackend.saveClipboardFiles(files)
    },
    async rotateAccessToken() {
      const bridge = readNativeBridge()
      if (!bridge?.rotateAccessToken) {
        throw new Error('Token rotation is unavailable in this runtime')
      }
      return await bridge.rotateAccessToken()
    },
    shell(): RendererShellBridge | null {
      return readNativeBridge()?.shell ?? null
    },
    terminal() {
      return terminalBridge
    },
  }
}

// The collapsed bridge is `kind()`-agnostic — every method reads
// `window.goblinNative` lazily, so the same instance handles both
// the Electron-embedded runtime (where `goblinNative` is exposed by
// the preload) and the standalone web runtime (where it isn't).
//
// We rebuild the outer bridge on every call rather than memoizing:
// the inner terminal bridge is memoized separately (it owns the
// WebSocket and must be a singleton), but everything else — IPC,
// shell, capabilities, clipboard backend, bootstrap — is just a
// closure over the live `goblinNative`. Rebuilding is cheap
// (single closure allocation per access — well under the IPC
// round-trip the bridge is built to support) and means tests (and
// StrictMode double-mounts in dev) can swap the preload between
// phases of an effect without breaking the bridge shape.
export function getRendererBridge(): RendererBridge {
  if (testOverride) return testOverride
  return createRendererBridge()
}

// Test override. When set to a non-null bridge, every
// `getRendererBridge()` call returns that bridge verbatim. When
// cleared back to `null`, the next call rebuilds from the live
// `window.goblinNative`. Production code never touches this.
let testOverride: RendererBridge | null = null
export function setRendererBridgeForTests(bridge: RendererBridge | null): void {
  testOverride = bridge
}
