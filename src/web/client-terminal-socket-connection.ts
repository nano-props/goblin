import {
  createSocketRequestId,
  createTerminalWebSocketUrl,
  encodeClientMessage,
  parseTerminalSocketServerMessage,
} from '#/web/client-terminal-socket-utils.ts'
import type {
  TerminalClientMessage,
  TerminalRealtimeMessage,
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs,
  TerminalSocketServerMessage,
} from '#/shared/terminal-socket.ts'
import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'

// Matches the server-side HEARTBEAT_INTERVAL_MS. Kept client-local so the
// browser socket layer does not import a server module.
const TERMINAL_CLIENT_HEARTBEAT_INTERVAL_MS = 30_000
const TERMINAL_SOCKET_OPEN_TIMEOUT_MS = 10_000
const TERMINAL_REQUEST_TIMEOUT_MS = 30_000
const TERMINAL_HEALTH_PROBE_TIMEOUT_MS = 5_000

export interface TerminalSocketServerConfig {
  url: string
  accessToken: string
  clientId: string
}

interface TerminalSocketConnectionOptions {
  getServerConfig: () => TerminalSocketServerConfig
  hasRealtimeSubscribers: () => boolean
  onRealtimeMessage(message: TerminalRealtimeMessage, currentClientId: string): void
}

type PendingSocketRequest = {
  action: TerminalSocketRequestAction
  resolve: (value: TerminalSocketResponseOutputs[TerminalSocketRequestAction]) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

type SocketConnectionConfig = { url: string; clientId: string }

export interface TerminalSocketConnection {
  openForRealtime(): void
  closeSocketIfIdle(): void
  kickReconnect(): void
  prewarm(): Promise<void>
  request<TAction extends TerminalSocketRequestAction>(
    action: TAction,
    input: TerminalSocketRequestInputs[TAction],
  ): Promise<TerminalSocketResponseOutputs[TAction]>
}

export function createTerminalSocketConnection(options: TerminalSocketConnectionOptions): TerminalSocketConnection {
  let reconnectTimer: number | null = null
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null
  let quitting = isAppQuitting()
  let pendingSocketOpenRequests = 0
  const pendingSocketRequests = new Map<string, PendingSocketRequest>()
  const pendingHealthProbes = new Map<
    string,
    { socket: WebSocket; generation: number; timeout: ReturnType<typeof setTimeout> }
  >()

  const socketLifecycle = createWebSocketLifecycle<SocketConnectionConfig>({
    resolveConnection: resolveSocketConnectionConfig,
    createSocket(connection) {
      return new WebSocket(connection.url)
    },
    shouldOpen() {
      return typeof WebSocket !== 'undefined' && !quitting
    },
    shouldKeepOpen: shouldKeepSocketOpen,
    closeReason: 'Terminal socket closed',
    errorReason: 'Terminal socket error',
    onOpen(entry) {
      startHeartbeat(entry.socket, entry.generation)
    },
    onMessage(event, entry) {
      const message = parseTerminalSocketServerMessage(event.data)
      if (message) handleSocketMessage(message, entry.connection.clientId)
    },
    onDisconnect(_entry, context) {
      stopHeartbeat()
      clearPendingHealthProbes()
      rejectPendingSocketRequests(context.reason)
      if (context.idleClose) {
        if (options.hasRealtimeSubscribers()) socketLifecycle.ensureSocket()
        return
      }
      scheduleReconnect()
    },
    onForgetUnavailable() {
      stopHeartbeat()
      clearPendingHealthProbes()
    },
  })

  subscribeAppQuitting(() => {
    quitting = true
    clearReconnectTimer()
    clearPendingHealthProbes()
    rejectPendingSocketRequests('Terminal socket closed')
    socketLifecycle.closeAndForget()
  })

  return {
    openForRealtime() {
      socketLifecycle.cancelIdleClose()
      ensureSocket()
    },
    closeSocketIfIdle,
    kickReconnect,
    prewarm() {
      return waitForSocketOpen()
        .then(() => undefined)
        .catch(() => {})
    },
    request,
  }

  function shouldKeepSocketOpen(): boolean {
    return options.hasRealtimeSubscribers() || pendingSocketOpenRequests > 0 || pendingSocketRequests.size > 0
  }

  function isActiveSocket(currentSocket: WebSocket, generation: number): boolean {
    return socketLifecycle.isActive(currentSocket, generation)
  }

  function clearReconnectTimer() {
    if (reconnectTimer === null) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function rejectPendingSocketRequests(message: string) {
    const error = new Error(message)
    for (const pending of pendingSocketRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    pendingSocketRequests.clear()
  }

  function clearPendingHealthProbes() {
    for (const pending of pendingHealthProbes.values()) clearTimeout(pending.timeout)
    pendingHealthProbes.clear()
  }

  function hasPendingHealthProbe(currentSocket: WebSocket, generation: number): boolean {
    for (const pending of pendingHealthProbes.values()) {
      if (pending.socket === currentSocket && pending.generation === generation) return true
    }
    return false
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null || !options.hasRealtimeSubscribers() || quitting) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      ensureSocket()
    }, 300)
  }

  function kickReconnect() {
    if (quitting) return
    if (!options.hasRealtimeSubscribers()) return
    if (typeof WebSocket === 'undefined') return
    socketLifecycle.forgetUnavailableSocket()
    const current = socketLifecycle.active()
    if (!current) {
      ensureSocket()
      return
    }
    if (current.socket.readyState === WebSocket.OPEN) startHealthProbe(current.socket, current.generation)
  }

  function resolveSocketConnectionConfig(): SocketConnectionConfig | null {
    try {
      const server = options.getServerConfig()
      return {
        url: createTerminalWebSocketUrl(server.url, server.accessToken, server.clientId),
        clientId: server.clientId,
      }
    } catch {
      return null
    }
  }

  function ensureSocket() {
    socketLifecycle.ensureSocket()
  }

  function handleSocketMessage(message: TerminalSocketServerMessage, currentClientId: string): void {
    switch (message.type) {
      case 'response':
        settleSocketRequest(message)
        return
      case 'pong':
        settleHealthProbe(message)
        return
      default:
        options.onRealtimeMessage(message, currentClientId)
        return
    }
  }

  function startHeartbeat(currentSocket: WebSocket, generation: number): void {
    stopHeartbeat()
    heartbeatTimer = globalThis.setInterval(() => {
      if (!isActiveSocket(currentSocket, generation)) {
        stopHeartbeat()
        return
      }
      if (currentSocket.readyState !== WebSocket.OPEN) return
      try {
        currentSocket.send(JSON.stringify({ type: 'heartbeat' }))
      } catch {
        forceSocketReconnect('Terminal heartbeat send failed', currentSocket)
      }
    }, TERMINAL_CLIENT_HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer === null) return
    globalThis.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function startHealthProbe(currentSocket: WebSocket, generation: number): void {
    if (!isActiveSocket(currentSocket, generation) || currentSocket.readyState !== WebSocket.OPEN) return
    if (hasPendingHealthProbe(currentSocket, generation)) return
    const requestId = createSocketRequestId()
    const timeout = setTimeout(() => {
      const pending = pendingHealthProbes.get(requestId)
      if (!pending) return
      pendingHealthProbes.delete(requestId)
      if (!isActiveSocket(pending.socket, pending.generation)) return
      forceSocketReconnect('Terminal health probe timed out', pending.socket)
    }, TERMINAL_HEALTH_PROBE_TIMEOUT_MS)
    pendingHealthProbes.set(requestId, { socket: currentSocket, generation, timeout })
    try {
      currentSocket.send(encodeClientMessage({ type: 'ping', requestId }))
    } catch {
      clearTimeout(timeout)
      pendingHealthProbes.delete(requestId)
      forceSocketReconnect('Terminal health probe send failed', currentSocket)
    }
  }

  function settleHealthProbe(message: Extract<TerminalSocketServerMessage, { type: 'pong' }>): void {
    const pending = pendingHealthProbes.get(message.requestId)
    if (!pending) return
    pendingHealthProbes.delete(message.requestId)
    clearTimeout(pending.timeout)
  }

  function forceSocketReconnect(reason: string, currentSocket: WebSocket | null = socketLifecycle.active()?.socket ?? null): void {
    if (!currentSocket) return
    socketLifecycle.disconnect(reason, currentSocket)
  }

  function closeSocketIfIdle() {
    if (!socketLifecycle.requestIdleClose()) return
    clearReconnectTimer()
  }

  function settleSocketRequest(message: Extract<TerminalSocketServerMessage, { type: 'response' }>) {
    const pending = pendingSocketRequests.get(message.requestId)
    if (!pending || pending.action !== message.action) return
    pendingSocketRequests.delete(message.requestId)
    clearTimeout(pending.timeout)
    if (message.ok) pending.resolve(message.payload)
    else pending.reject(new Error(message.error))
    closeSocketIfIdle()
  }

  async function request<TAction extends TerminalSocketRequestAction>(
    action: TAction,
    input: TerminalSocketRequestInputs[TAction],
  ): Promise<TerminalSocketResponseOutputs[TAction]> {
    pendingSocketOpenRequests += 1
    socketLifecycle.cancelIdleClose()
    let ws: WebSocket
    try {
      ws = await waitForSocketOpen()
    } finally {
      pendingSocketOpenRequests = Math.max(0, pendingSocketOpenRequests - 1)
    }
    return await new Promise<TerminalSocketResponseOutputs[TAction]>((resolve, reject) => {
      const requestId = createSocketRequestId()
      const timeout = setTimeout(() => {
        const pending = pendingSocketRequests.get(requestId)
        if (!pending) return
        pendingSocketRequests.delete(requestId)
        clearTimeout(pending.timeout)
        forceSocketReconnect('Terminal request timed out', ws)
        reject(new Error('Terminal request timed out'))
      }, TERMINAL_REQUEST_TIMEOUT_MS)
      pendingSocketRequests.set(requestId, {
        action,
        resolve: (value) => resolve(value as TerminalSocketResponseOutputs[TAction]),
        reject,
        timeout,
      })
      try {
        ws.send(
          encodeClientMessage({ type: 'request', requestId, action, input } as Extract<
            TerminalClientMessage,
            { action: TAction }
          >),
        )
      } catch (error) {
        clearTimeout(timeout)
        pendingSocketRequests.delete(requestId)
        forceSocketReconnect('Terminal request send failed', ws)
        reject(error)
      }
    })
  }

  function waitForSocketOpen(): Promise<WebSocket> {
    if (typeof WebSocket === 'undefined') return Promise.reject(new Error('Terminal socket unavailable'))
    ensureSocket()
    const current = socketLifecycle.active()
    if (!current) return Promise.reject(new Error('Terminal socket unavailable'))
    const currentSocket = current.socket
    if (currentSocket.readyState === WebSocket.OPEN) return Promise.resolve(currentSocket)
    if (currentSocket.readyState === WebSocket.CLOSED || currentSocket.readyState === WebSocket.CLOSING) {
      return Promise.reject(new Error('Terminal socket closed before open'))
    }
    return new Promise<WebSocket>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        settle(() => {
          if (socketLifecycle.active() === current) socketLifecycle.disconnect('Terminal socket open timed out', currentSocket)
          reject(new Error('Terminal socket open timed out'))
        })
      }, TERMINAL_SOCKET_OPEN_TIMEOUT_MS)
      const settle = (fn: () => void) => {
        cleanup()
        fn()
      }
      const handleOpen = () => {
        settle(() => {
          if (socketLifecycle.active() === current && currentSocket.readyState === WebSocket.OPEN) resolve(currentSocket)
          else reject(new Error('Terminal socket replaced before open'))
        })
      }
      const handleClose = (event: CloseEvent) =>
        settle(() => reject(new Error(formatSocketClosedBeforeOpenMessage(event))))
      const handleError = () => settle(() => reject(new Error('Terminal socket error before open')))
      const cleanup = () => {
        if (timeout !== null) {
          clearTimeout(timeout)
          timeout = null
        }
        currentSocket.removeEventListener?.('open', handleOpen)
        currentSocket.removeEventListener?.('close', handleClose)
        currentSocket.removeEventListener?.('error', handleError)
      }
      currentSocket.addEventListener('open', handleOpen)
      currentSocket.addEventListener('close', handleClose)
      currentSocket.addEventListener('error', handleError)
    })
  }

}

function formatSocketClosedBeforeOpenMessage(event: CloseEvent): string {
  const detail = event.reason ? `${event.code}: ${event.reason}` : String(event.code)
  return `Terminal socket closed before open (${detail})`
}
