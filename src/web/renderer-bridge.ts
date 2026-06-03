import type { RendererBootstrapSnapshot } from '#/shared/bootstrap.ts'
import type { RendererBridge } from '#/web/renderer-bridge-types.ts'
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

function readBridge(): Window['goblin'] | null {
  try {
    return window.goblin ?? null
  } catch {
    return null
  }
}

function readServerTerminalConfig(): RendererServerTerminalConfig | null {
  const server = readWebBootstrap(readOrCreateWebTerminalClientId).initialServer
  if (!server?.url || !server?.secret) return null
  const clientId = normalizeRendererServerClientId(server.clientId) ?? readOrCreateWebTerminalClientId()
  if (!clientId) return null
  return { url: server.url, secret: server.secret, clientId }
}

function electronBridge(): RendererBridge {
  const serverTerminalBridge = (() => {
    const server = readBridge()?.initialServer
    if (!server?.url || !server?.secret) return null
    return createServerTerminalBridge({
      getAttachmentId: readOrCreateWebTerminalAttachmentId,
      getServerConfig() {
        const nextServer = readBridge()?.initialServer
        if (!nextServer?.url || !nextServer?.secret) throw new Error('Renderer terminal bridge is unavailable')
        const clientId = normalizeRendererServerClientId(nextServer.clientId) ?? readOrCreateWebTerminalClientId()
        if (!clientId) throw new Error('Renderer terminal bridge is unavailable')
        return { url: nextServer.url, secret: nextServer.secret, clientId }
      },
      notifyBell(input) {
        const bridge = readBridge()
        if (!bridge?.terminal) throw new Error('Renderer terminal bridge is unavailable')
        return bridge.terminal.notifyBell(input)
      },
      sendTestNotification() {
        const bridge = readBridge()
        if (!bridge?.terminal) throw new Error('Renderer terminal bridge is unavailable')
        return bridge.terminal.sendTestNotification()
      },
      setBadge(count) {
        readBridge()?.terminal?.setBadge(count)
      },
    })
  })()
  return {
    getBootstrap() {
      const bridge = readBridge()
      const bootstrap = readWebBootstrap(readOrCreateWebTerminalClientId)
      return {
        homeDir: typeof bridge?.homeDir === 'string' ? bridge.homeDir : bootstrap.homeDir,
        initialI18n: bridge?.initialI18n ?? bootstrap.initialI18n ?? null,
        initialSettings: bridge?.initialSettings ?? bootstrap.initialSettings ?? null,
        initialServer: bridge?.initialServer ?? bootstrap.initialServer ?? null,
      }
    },
    invokeRpc(request) {
      const bridge = readBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.invokeRpc(request)
    },
    abortRpc(requestId) {
      const bridge = readBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.abortRpc(requestId)
    },
    onRpcEvent(cb) {
      const bridge = readBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.onEvent(cb)
    },
    pathForFile(file) {
      const bridge = readBridge()
      if (!bridge) throw new Error('Goblin bridge is unavailable')
      return bridge.pathForFile(file)
    },
    shell() {
      return readBridge()?.shell ?? null
    },
    terminal() {
      if (!serverTerminalBridge) throw new Error('Renderer terminal bridge is unavailable')
      return serverTerminalBridge
    },
  }
}

function webBridge(): RendererBridge {
  const terminalBridge = createServerTerminalBridge({
    getAttachmentId: readOrCreateWebTerminalAttachmentId,
    getServerConfig() {
      const server = readServerTerminalConfig()
      if (!server) throw new Error('Web renderer terminal bridge is unavailable')
      return server
    },
  })

  return {
    getBootstrap() {
      return readWebBootstrap(readOrCreateWebTerminalClientId)
    },
    async invokeRpc() {
      throw new Error('Web renderer RPC bridge is unavailable')
    },
    async abortRpc() {
      return false
    },
    onRpcEvent() {
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
  return readBridge() ? electronBridge() : webBridge()
}

let currentBridge: RendererBridge | null = null
let currentBridgeKind: 'electron' | 'web' | null = null
let hasTestOverride = false

export function getRendererBridge(): RendererBridge {
  if (hasTestOverride && currentBridge) return currentBridge
  const bridgeAvailable = readBridge() !== null
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
