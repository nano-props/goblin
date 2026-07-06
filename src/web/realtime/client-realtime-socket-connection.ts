import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'
import { createWebSocketLifecycle } from '#/web/lib/websocket-lifecycle.ts'

const CLIENT_REALTIME_HEARTBEAT_INTERVAL_MS = 30_000
const REALTIME_SOCKET_OPEN_TIMEOUT_MS = 10_000
const REALTIME_REQUEST_TIMEOUT_MS = 30_000
const REALTIME_HEALTH_PROBE_TIMEOUT_MS = 5_000

export interface ClientRealtimeSocketConnectionConfig {
  url: string
  clientId: string
}

type RealtimeAction<TInputs, TOutputs> = keyof TInputs & keyof TOutputs & string

type PendingSocketRequest<TAction extends string, TValue> = {
  action: TAction
  resolve: (value: TValue) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

type RealtimeResponseMessage<TAction extends string> =
  | {
      type: 'response'
      requestId: string
      ok: true
      action: TAction
      payload: unknown
    }
  | {
      type: 'response'
      requestId: string
      ok: false
      action: TAction
      error: string
    }

type RealtimePongMessage = { type: 'pong'; requestId: string }

export interface ClientRealtimeSocketConnectionOptions<
  TInputs extends object,
  TOutputs extends object,
  TServerMessage,
  TRealtimeMessage,
> {
  resolveConnection: () => ClientRealtimeSocketConnectionConfig | null
  hasRealtimeSubscribers: () => boolean
  onRealtimeMessage(message: TRealtimeMessage, currentClientId: string): void
  parseServerMessage(data: unknown): TServerMessage | null
  encodeClientMessage(message: unknown): string
  createRequestId(): string
  errorPrefix: string
}

export interface ClientRealtimeSocketConnection<TInputs extends object, TOutputs extends object> {
  openForRealtime(): void
  closeSocketIfIdle(): void
  kickReconnect(): void
  prewarm(): Promise<void>
  request<TAction extends RealtimeAction<TInputs, TOutputs>>(
    action: TAction,
    input: TInputs[TAction],
  ): Promise<TOutputs[TAction]>
}

export function createClientRealtimeSocketConnection<
  TInputs extends object,
  TOutputs extends object,
  TServerMessage,
  TRealtimeMessage,
>(
  options: ClientRealtimeSocketConnectionOptions<TInputs, TOutputs, TServerMessage, TRealtimeMessage>,
): ClientRealtimeSocketConnection<TInputs, TOutputs> {
  type Action = RealtimeAction<TInputs, TOutputs>
  type Output = TOutputs[Action]

  const socketLabel = `${options.errorPrefix} socket`
  const requestLabel = `${options.errorPrefix} request`
  const heartbeatLabel = `${options.errorPrefix} heartbeat`
  const healthProbeLabel = `${options.errorPrefix} health probe`

  let reconnectTimer: number | null = null
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null
  let quitting = isAppQuitting()
  let pendingSocketOpenRequests = 0
  const pendingSocketRequests = new Map<string, PendingSocketRequest<Action, Output>>()
  const pendingHealthProbes = new Map<
    string,
    { socket: WebSocket; generation: number; timeout: ReturnType<typeof setTimeout> }
  >()

  const socketLifecycle = createWebSocketLifecycle<ClientRealtimeSocketConnectionConfig>({
    resolveConnection: options.resolveConnection,
    createSocket(connection) {
      return new WebSocket(connection.url)
    },
    shouldOpen() {
      return typeof WebSocket !== 'undefined' && !quitting
    },
    shouldKeepOpen: shouldKeepSocketOpen,
    closeReason: `${socketLabel} closed`,
    errorReason: `${socketLabel} error`,
    onOpen(entry) {
      startHeartbeat(entry.socket, entry.generation)
    },
    onMessage(event, entry) {
      const message = options.parseServerMessage(event.data)
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
    onUnavailableSocketDropped() {
      stopHeartbeat()
      clearPendingHealthProbes()
    },
  })

  subscribeAppQuitting(() => {
    quitting = true
    clearReconnectTimer()
    clearPendingHealthProbes()
    rejectPendingSocketRequests(`${socketLabel} closed`)
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

  function ensureSocket() {
    socketLifecycle.ensureSocket()
  }

  function handleSocketMessage(message: TServerMessage, currentClientId: string): void {
    if (isRealtimeResponseMessage<Action>(message)) {
      settleSocketRequest(message)
      return
    }
    if (isRealtimePongMessage(message)) {
      settleHealthProbe(message)
      return
    }
    options.onRealtimeMessage(message as unknown as TRealtimeMessage, currentClientId)
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
        currentSocket.send(options.encodeClientMessage({ type: 'heartbeat' }))
      } catch {
        forceSocketReconnect(`${heartbeatLabel} send failed`, currentSocket)
      }
    }, CLIENT_REALTIME_HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer === null) return
    globalThis.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  function startHealthProbe(currentSocket: WebSocket, generation: number): void {
    if (!isActiveSocket(currentSocket, generation) || currentSocket.readyState !== WebSocket.OPEN) return
    if (hasPendingHealthProbe(currentSocket, generation)) return
    const requestId = options.createRequestId()
    const timeout = setTimeout(() => {
      const pending = pendingHealthProbes.get(requestId)
      if (!pending) return
      pendingHealthProbes.delete(requestId)
      if (!isActiveSocket(pending.socket, pending.generation)) return
      forceSocketReconnect(`${healthProbeLabel} timed out`, pending.socket)
    }, REALTIME_HEALTH_PROBE_TIMEOUT_MS)
    pendingHealthProbes.set(requestId, { socket: currentSocket, generation, timeout })
    try {
      currentSocket.send(options.encodeClientMessage({ type: 'ping', requestId }))
    } catch {
      clearTimeout(timeout)
      pendingHealthProbes.delete(requestId)
      forceSocketReconnect(`${healthProbeLabel} send failed`, currentSocket)
    }
  }

  function settleHealthProbe(message: RealtimePongMessage): void {
    const pending = pendingHealthProbes.get(message.requestId)
    if (!pending) return
    pendingHealthProbes.delete(message.requestId)
    clearTimeout(pending.timeout)
  }

  function forceSocketReconnect(
    reason: string,
    currentSocket: WebSocket | null = socketLifecycle.active()?.socket ?? null,
  ): void {
    if (!currentSocket) return
    socketLifecycle.disconnect(reason, currentSocket)
  }

  function closeSocketIfIdle() {
    if (!socketLifecycle.requestIdleClose()) return
    clearReconnectTimer()
  }

  function settleSocketRequest(message: RealtimeResponseMessage<Action>) {
    const pending = pendingSocketRequests.get(message.requestId)
    if (!pending || pending.action !== message.action) return
    pendingSocketRequests.delete(message.requestId)
    clearTimeout(pending.timeout)
    if (message.ok) pending.resolve(message.payload as Output)
    else pending.reject(new Error(message.error))
    closeSocketIfIdle()
  }

  async function request<TAction extends Action>(
    action: TAction,
    input: TInputs[TAction],
  ): Promise<TOutputs[TAction]> {
    pendingSocketOpenRequests += 1
    socketLifecycle.cancelIdleClose()
    let ws: WebSocket
    try {
      ws = await waitForSocketOpen()
    } finally {
      pendingSocketOpenRequests = Math.max(0, pendingSocketOpenRequests - 1)
    }
    return await new Promise<TOutputs[TAction]>((resolve, reject) => {
      const requestId = options.createRequestId()
      const timeout = setTimeout(() => {
        const pending = pendingSocketRequests.get(requestId)
        if (!pending) return
        pendingSocketRequests.delete(requestId)
        clearTimeout(pending.timeout)
        forceSocketReconnect(`${requestLabel} timed out`, ws)
        reject(new Error(`${requestLabel} timed out`))
      }, REALTIME_REQUEST_TIMEOUT_MS)
      pendingSocketRequests.set(requestId, {
        action,
        resolve: (value) => resolve(value as TOutputs[TAction]),
        reject,
        timeout,
      } as PendingSocketRequest<Action, Output>)
      try {
        ws.send(options.encodeClientMessage({ type: 'request', requestId, action, input }))
      } catch (error) {
        clearTimeout(timeout)
        pendingSocketRequests.delete(requestId)
        forceSocketReconnect(`${requestLabel} send failed`, ws)
        reject(error)
      }
    })
  }

  function waitForSocketOpen(): Promise<WebSocket> {
    if (typeof WebSocket === 'undefined') return Promise.reject(new Error(`${socketLabel} unavailable`))
    ensureSocket()
    const current = socketLifecycle.active()
    if (!current) return Promise.reject(new Error(`${socketLabel} unavailable`))
    const currentSocket = current.socket
    if (currentSocket.readyState === WebSocket.OPEN) return Promise.resolve(currentSocket)
    if (currentSocket.readyState === WebSocket.CLOSED || currentSocket.readyState === WebSocket.CLOSING) {
      return Promise.reject(new Error(`${socketLabel} closed before open`))
    }
    return new Promise<WebSocket>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        settle(() => {
          if (socketLifecycle.active() === current)
            socketLifecycle.disconnect(`${socketLabel} open timed out`, currentSocket)
          reject(new Error(`${socketLabel} open timed out`))
        })
      }, REALTIME_SOCKET_OPEN_TIMEOUT_MS)
      const settle = (fn: () => void) => {
        cleanup()
        fn()
      }
      const handleOpen = () => {
        settle(() => {
          if (socketLifecycle.active() === current && currentSocket.readyState === WebSocket.OPEN)
            resolve(currentSocket)
          else reject(new Error(`${socketLabel} replaced before open`))
        })
      }
      const handleClose = (event: CloseEvent) =>
        settle(() => reject(new Error(formatSocketClosedBeforeOpenMessage(socketLabel, event))))
      const handleError = () => settle(() => reject(new Error(`${socketLabel} error before open`)))
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

function isRealtimeResponseMessage<TAction extends string>(
  value: unknown,
): value is RealtimeResponseMessage<TAction> {
  if (!value || typeof value !== 'object') return false
  const message = value as { type?: unknown; requestId?: unknown; action?: unknown; ok?: unknown }
  return (
    message.type === 'response' &&
    typeof message.requestId === 'string' &&
    typeof message.action === 'string' &&
    typeof message.ok === 'boolean'
  )
}

function isRealtimePongMessage(value: unknown): value is RealtimePongMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as { type?: unknown; requestId?: unknown }
  return message.type === 'pong' && typeof message.requestId === 'string'
}

function formatSocketClosedBeforeOpenMessage(socketLabel: string, event: CloseEvent): string {
  const detail = event.reason ? `${event.code}: ${event.reason}` : String(event.code)
  return `${socketLabel} closed before open (${detail})`
}
