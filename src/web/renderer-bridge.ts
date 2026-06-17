import { ELECTRON_RENDERER_CAPABILITIES } from '#/shared/bootstrap.ts'
import type { RendererBootstrapSnapshot, RendererNativeCapability } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
import { createHttpClipboardBackend } from '#/web/clipboard/http-backend.ts'
import {
  emptyRendererBridgeBootstrap as emptyBootstrapSnapshot,
  normalizeRendererServerClientId,
  readWebBootstrap,
} from '#/web/renderer-bootstrap-bridge.ts'
import {
  createServerTerminalBridge,
  readOrCreateWebTerminalAttachmentId,
  type RendererServerTerminalConfig,
} from '#/web/renderer-terminal-bridge.ts'

const WEB_TERMINAL_CLIENT_ID_STORAGE_KEY = 'goblin:web-terminal-client-id'

function readServerTerminalConfig(): RendererServerTerminalConfig | null {
  const server = readWebBootstrap(readOrCreateWebTerminalClientId).initialServer
  if (!server?.url) return null
  const clientId = normalizeRendererServerClientId(server.clientId) ?? readOrCreateWebTerminalClientId()
  if (!clientId) return null
  return { url: server.url, accessToken: server.accessToken ?? '', clientId }
}

function electronBridge(): RendererBridge {
  const capabilities = new Set<RendererNativeCapability>([...ELECTRON_RENDERER_CAPABILITIES])
  const serverTerminalBridge = (() => {
    const server = readWebBootstrap(readOrCreateWebTerminalClientId).initialServer
    if (!server?.url) return null
    return createServerTerminalBridge({
      getAttachmentId: readOrCreateWebTerminalAttachmentId,
      getServerConfig() {
        const nextServer = readWebBootstrap(readOrCreateWebTerminalClientId).initialServer
        if (!nextServer?.url) throw new Error('Renderer terminal bridge is unavailable')
        const clientId = normalizeRendererServerClientId(nextServer.clientId) ?? readOrCreateWebTerminalClientId()
        if (!clientId) throw new Error('Renderer terminal bridge is unavailable')
        // `accessToken` is optional at the bridge layer: when present
        // (embedded + dev) it's sent as `?t=` on the WebSocket URL;
        // when absent the WS upgrade relies on the http-only cookie
        // (browser-prod) or fails 401 (no-cookie tests).
        return { url: nextServer.url, accessToken: nextServer.accessToken ?? '', clientId }
      },
      notifyBell(input) {
        const bridge = readNativeBridge()
        if (!bridge?.terminal) throw new Error('Renderer terminal bridge is unavailable')
        return bridge.terminal.notifyBell(input)
      },
      sendTestNotification() {
        const bridge = readNativeBridge()
        if (!bridge?.terminal) throw new Error('Renderer terminal bridge is unavailable')
        return bridge.terminal.sendTestNotification()
      },
      setBadge(count) {
        readNativeBridge()?.terminal?.setBadge(count)
      },
    })
  })()
  return {
    kind() {
      return 'electron'
    },
    hasCapability(capability) {
      return capabilities.has(capability)
    },
    getBootstrap() {
      return readWebBootstrap(readOrCreateWebTerminalClientId)
    },
    invokeIpc(request) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.invokeIpc(request)
    },
    abortIpc(requestId) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.abortIpc(requestId)
    },
    onIpcEvent(cb) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.onEvent(cb)
    },
    onEffectIntent(cb) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.onIntent?.(cb) ?? (() => {})
    },
    pathForFile(file) {
      const bridge = readNativeBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.pathForFile(file)
    },
    async rotateAccessToken() {
      const bridge = readNativeBridge()
      if (!bridge?.rotateAccessToken) throw new Error('Token rotation is unavailable in this runtime')
      return await bridge.rotateAccessToken()
    },
    saveClipboardFiles(files) {
      const bridge = readNativeBridge()
      // Older preloads may not expose `saveClipboardFiles`; treat as a
      // total failure so the resolver falls back to a single
      // `paste-file-failed` toast instead of throwing.
      if (!bridge || typeof bridge.saveClipboardFiles !== 'function') return Promise.resolve([])
      return bridge.saveClipboardFiles(files)
    },
    shell() {
      return readNativeBridge()?.shell ?? null
    },
    terminal() {
      if (!serverTerminalBridge) throw new Error('Renderer terminal bridge is unavailable')
      return serverTerminalBridge
    },
  }
}

function webBridge(): RendererBridge {
  const bootstrap = readWebBootstrap(readOrCreateWebTerminalClientId)
  const terminalBridge = createServerTerminalBridge({
    getAttachmentId: readOrCreateWebTerminalAttachmentId,
    getServerConfig() {
      const server = readServerTerminalConfig()
      if (!server) throw new Error('Web renderer terminal bridge is unavailable')
      return server
    },
  })
  // Clipboard backend reuses the same bootstrap-derived server URL +
  // access token. Constructed lazily inside `saveClipboardFiles` so a
  // missing initialServer (which makes paste impossible anyway) doesn't
  // crash the whole bridge.
  const clipboardBackend = (() => {
    const server = bootstrap.initialServer
    if (!server?.url) return null
    return createHttpClipboardBackend({
      url: server.url,
      accessToken: server.accessToken ?? '',
    })
  })()

  return {
    kind() {
      return 'web'
    },
    hasCapability() {
      return false
    },
    getBootstrap() {
      return bootstrap
    },
    async invokeIpc() {
      throw new Error('Web renderer IPC bridge is unavailable')
    },
    async abortIpc() {
      return false
    },
    onIpcEvent() {
      return () => {}
    },
    onEffectIntent() {
      return () => {}
    },
    pathForFile() {
      return ''
    },
    saveClipboardFiles(files) {
      if (!clipboardBackend) return Promise.resolve([])
      return clipboardBackend.saveClipboardFiles(files)
    },
    shell() {
      return null
    },
    terminal() {
      return terminalBridge
    },
  }
}

function detectRendererBridge(): RendererBridge {
  return readNativeBridge() ? electronBridge() : webBridge()
}

let currentBridge: RendererBridge | null = null
let currentBridgeKind: 'electron' | 'web' | null = null
let hasTestOverride = false

export function getRendererBridge(): RendererBridge {
  if (hasTestOverride && currentBridge) return currentBridge
  const bridgeAvailable = readNativeBridge() !== null
  if (
    !currentBridge ||
    (bridgeAvailable && currentBridgeKind !== 'electron') ||
    (!bridgeAvailable && currentBridgeKind !== 'web')
  ) {
    currentBridge = detectRendererBridge()
    currentBridgeKind = bridgeAvailable ? 'electron' : 'web'
  }
  return currentBridge
}

export function setRendererBridgeForTests(bridge: RendererBridge | null): void {
  hasTestOverride = bridge !== null
  currentBridge = bridge
  currentBridgeKind = null
}

export function emptyRendererBridgeBootstrap(): RendererBootstrapSnapshot {
  return emptyBootstrapSnapshot()
}

function readOrCreateWebTerminalClientId(): string {
  const fallback = `web_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  try {
    const storage = window.localStorage
    const existing = storage?.getItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY)?.trim()
    if (existing) return existing
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `web_${crypto.randomUUID().replace(/-/g, '')}`
        : fallback
    storage?.setItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY, created)
    return created
  } catch {
    return fallback
  }
}
