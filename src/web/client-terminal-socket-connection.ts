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
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null
  let manualSocketClose = false
  let socketGeneration = 0
  let quitting = isAppQuitting()
  let pendingSocketOpenRequests = 0
  const pendingSocketRequests = new Map<string, PendingSocketRequest>()
  const pendingHealthProbes = new Map<
    string,
    { socket: WebSocket; generation: number; timeout: ReturnType<typeof setTimeout> }
  >()

  subscribeAppQuitting(() => {
    quitting = true
    manualSocketClose = true
    clearReconnectTimer()
    clearPendingHealthProbes()
    rejectPendingSocketRequests('Terminal socket closed')
    const currentSocket = socket
    socket = null
    if (!currentSocket) return
    try {
      currentSocket.close()
    } catch {}
  })

  return {
    openForRealtime() {
      manualSocketClose = false
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
    return socket === currentSocket && socketGeneration === generation
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
    const currentSocket = socket
    if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED) {
      ensureSocket()
      return
    }
    if (currentSocket.readyState === WebSocket.OPEN) startHealthProbe(currentSocket, socketGeneration)
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
    if (socket || typeof WebSocket === 'undefined' || quitting) return
    const connection = resolveSocketConnectionConfig()
    if (!connection) return
    manualSocketClose = false
    const generation = (socketGeneration += 1)
    const currentSocket = new WebSocket(connection.url)
    socket = currentSocket
    currentSocket.addEventListener('open', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      if (manualSocketClose && !shouldKeepSocketOpen()) {
        try {
          currentSocket.close()
        } catch {}
        return
      }
      startHeartbeat(currentSocket, generation)
    })
    currentSocket.addEventListener('message', (event) => {
      if (!isActiveSocket(currentSocket, generation)) return
      const message = parseTerminalSocketServerMessage(event.data)
      if (message) handleSocketMessage(message, connection.clientId)
    })
    currentSocket.addEventListener('close', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      stopHeartbeat()
      handleSocketDisconnection('Terminal socket closed')
    })
    currentSocket.addEventListener('error', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      stopHeartbeat()
      handleSocketDisconnection('Terminal socket error')
    })
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

  function forceSocketReconnect(reason: string, currentSocket: WebSocket | null = socket): void {
    if (!currentSocket) return
    if (socket === currentSocket) {
      stopHeartbeat()
      clearPendingHealthProbes()
      handleSocketDisconnection(reason)
    }
    try {
      currentSocket.close()
    } catch {}
  }

  function handleSocketDisconnection(reason: string) {
    const wasManual = manualSocketClose
    clearPendingHealthProbes()
    rejectPendingSocketRequests(reason)
    socket = null
    manualSocketClose = false
    if (wasManual) {
      if (options.hasRealtimeSubscribers()) ensureSocket()
      return
    }
    scheduleReconnect()
  }

  function closeSocketIfIdle() {
    if (shouldKeepSocketOpen() || !socket) return
    manualSocketClose = true
    clearReconnectTimer()
    if (socket.readyState === WebSocket.CONNECTING) return
    try {
      socket.close()
    } catch {}
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
    const currentSocket = socket
    if (!currentSocket) return Promise.reject(new Error('Terminal socket unavailable'))
    if (currentSocket.readyState === WebSocket.OPEN) return Promise.resolve(currentSocket)
    if (currentSocket.readyState === WebSocket.CLOSED || currentSocket.readyState === WebSocket.CLOSING) {
      return Promise.reject(new Error('Terminal socket closed before open'))
    }
    return new Promise<WebSocket>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        settle(() => {
          if (socket === currentSocket) {
            handleSocketDisconnection('Terminal socket open timed out')
            try {
              currentSocket.close()
            } catch {}
          }
          reject(new Error('Terminal socket open timed out'))
        })
      }, TERMINAL_SOCKET_OPEN_TIMEOUT_MS)
      const settle = (fn: () => void) => {
        cleanup()
        fn()
      }
      const handleOpen = () => {
        settle(() => {
          if (socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) resolve(currentSocket)
          else reject(new Error('Terminal socket replaced before open'))
        })
      }
      const handleClose = () => settle(() => reject(new Error('Terminal socket closed before open')))
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
