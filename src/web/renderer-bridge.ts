import { ELECTRON_RENDERER_CAPABILITIES } from '#/shared/bootstrap.ts'
import type { RendererBootstrapSnapshot, RendererNativeCapability, RendererPlatform } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
import { isRendererPlatform } from '#/web/renderer-bootstrap-bridge.ts'
import { readNativeBridge } from '#/web/native-bridge.ts'
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
  if (!server?.url || !server?.secret) return null
  const clientId = normalizeRendererServerClientId(server.clientId) ?? readOrCreateWebTerminalClientId()
  if (!clientId) return null
  return { url: server.url, secret: server.secret, clientId }
}

function electronBridge(): RendererBridge {
  const capabilities = new Set<RendererNativeCapability>([...ELECTRON_RENDERER_CAPABILITIES])
  const serverTerminalBridge = (() => {
    const server = readNativeBridge()?.initialServer
    if (!server?.url || !server?.secret) return null
    return createServerTerminalBridge({
      getAttachmentId: readOrCreateWebTerminalAttachmentId,
      getServerConfig() {
        const nextServer = readNativeBridge()?.initialServer
        if (!nextServer?.url || !nextServer?.secret) throw new Error('Renderer terminal bridge is unavailable')
        const clientId = normalizeRendererServerClientId(nextServer.clientId) ?? readOrCreateWebTerminalClientId()
        if (!clientId) throw new Error('Renderer terminal bridge is unavailable')
        return { url: nextServer.url, secret: nextServer.secret, clientId }
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
      return readNativeBridge()?.runtime?.kind === 'web' ? 'web' : 'electron'
    },
    hasCapability(capability) {
      const runtimeCapabilities = readNativeBridge()?.runtime?.capabilities
      return Array.isArray(runtimeCapabilities)
        ? runtimeCapabilities.includes(capability)
        : capabilities.has(capability)
    },
    getBootstrap() {
      const bridge = readNativeBridge()
      const bootstrap = readWebBootstrap(readOrCreateWebTerminalClientId)
      // Older preloads (or a test mock) may not surface `platform`. Fall
      // back to 'web' — the only contract we can honestly honour when
      // the host platform is unknown. The previous 'darwin' default
      // predated Windows/Linux support and would have shown the macOS
      // Settings UI on a Windows install that happened to be running
      // an out-of-date preload.
      let platform: RendererPlatform = bootstrap.platform
      if (bridge) {
        platform = isRendererPlatform(bridge.platform) ? bridge.platform : 'web'
      }
      return {
        runtime:
          bridge?.runtime &&
          (bridge.runtime.kind === 'electron' || bridge.runtime.kind === 'web') &&
          typeof bridge.runtime.bridgeVersion === 'number' &&
          Array.isArray(bridge.runtime.capabilities)
            ? bridge.runtime
            : bootstrap.runtime,
        homeDir: typeof bridge?.homeDir === 'string' ? bridge.homeDir : bootstrap.homeDir,
        platform,
        initialI18n: bridge?.initialI18n ?? bootstrap.initialI18n ?? null,
        initialSettings: bridge?.initialSettings ?? bootstrap.initialSettings ?? null,
        initialServer: bridge?.initialServer ?? bootstrap.initialServer ?? null,
      }
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

  return {
    kind() {
      return bootstrap.runtime.kind
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
