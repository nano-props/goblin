export interface RealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  forceClose?(code?: number, reason?: string): void
}

export interface RealtimeClientPresenceChange {
  clientId: string
  userId: string
  previousOnline: boolean
  online: boolean
}

export interface RealtimeBrokerOptions {
  onClientPresenceChanged(event: RealtimeClientPresenceChange): void
  onUserSocketsDrained(userId: string): void
  heartbeatTimeoutReason?: string
  shutdownReason?: string
}

/**
 * Client is expected to send a heartbeat every
 * `REALTIME_HEARTBEAT_INTERVAL_MS` (30 s). If a socket goes silent for
 * `REALTIME_HEARTBEAT_DEADLINE_MS` (90 s), that exact transport is closed.
 * Client presence remains online while any socket for that client remains.
 *
 * The actual silence detection latency is at most
 * `REALTIME_HEARTBEAT_DEADLINE_MS + REALTIME_HEARTBEAT_INTERVAL_MS` = 120 s
 * because scans run at the heartbeat interval.
 */
export const REALTIME_HEARTBEAT_INTERVAL_MS = 30_000
export const REALTIME_HEARTBEAT_DEADLINE_MS = 90_000
// This is a process resource limit, not an identity quota. The embedded
// server currently derives one user from its single access token, so a
// per-user limit would be equivalent while failing to cap total descriptors
// if the identity model expands later.
export const MAX_APP_REALTIME_SOCKETS = 32

export class AppRealtimeSocketLimitError extends Error {
  constructor() {
    super(`Too many app realtime subscribers (max ${MAX_APP_REALTIME_SOCKETS})`)
    this.name = 'AppRealtimeSocketLimitError'
  }
}

interface RealtimeSocketMeta {
  clientId: string
  userId: string
  lastHeartbeatAt: number
}

export class RealtimeBroker<TMessage> {
  private readonly options: Required<RealtimeBrokerOptions>
  private readonly socketsByUserId = new Map<string, Set<RealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<RealtimeSocket, RealtimeSocketMeta>()
  private readonly socketCountByClientKey = new Map<string, number>()
  private readonly heartbeatTimer: ReturnType<typeof setInterval>

  constructor(options: RealtimeBrokerOptions) {
    this.options = {
      heartbeatTimeoutReason: 'realtime heartbeat timeout',
      shutdownReason: 'server shutting down',
      ...options,
    }
    this.heartbeatTimer = setInterval(() => this.scanHeartbeats(), REALTIME_HEARTBEAT_INTERVAL_MS)
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref()
  }

  registerSocket(clientId: string, userId: string, socket: RealtimeSocket): void {
    if (this.socketMetaBySocket.has(socket)) this.unregisterSocket(socket)
    if (this.socketCount() >= MAX_APP_REALTIME_SOCKETS) throw new AppRealtimeSocketLimitError()
    let sockets = this.socketsByUserId.get(userId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByUserId.set(userId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, userId, lastHeartbeatAt: Date.now() })
    const clientKey = userClientKey(userId, clientId)
    const socketCount = this.socketCountByClientKey.get(clientKey) ?? 0
    this.socketCountByClientKey.set(clientKey, socketCount + 1)
    if (socketCount === 0) this.emitPresence(clientKey, false, true)
  }

  /** Update the last-heartbeat receipt time for the socket that sent it. */
  recordHeartbeat(socket: RealtimeSocket): void {
    const meta = this.socketMetaBySocket.get(socket)
    if (meta) meta.lastHeartbeatAt = Date.now()
  }

  private scanHeartbeats(): void {
    const now = Date.now()
    for (const [socket, meta] of Array.from(this.socketMetaBySocket)) {
      if (now - meta.lastHeartbeatAt < REALTIME_HEARTBEAT_DEADLINE_MS) continue
      this.closeSocket(socket, 1001, this.options.heartbeatTimeoutReason)
    }
  }

  unregisterSocket(socket: RealtimeSocket): void {
    const meta = this.socketMetaBySocket.get(socket)
    if (!meta) return
    const { clientId, userId } = meta
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const clientKey = userClientKey(userId, clientId)
    const socketCount = this.socketCountByClientKey.get(clientKey) ?? 0
    if (socketCount <= 1) {
      this.socketCountByClientKey.delete(clientKey)
      if (socketCount === 1) this.emitPresence(clientKey, true, false)
    } else {
      this.socketCountByClientKey.set(clientKey, socketCount - 1)
    }
    if (sockets.size > 0) return
    this.socketsByUserId.delete(userId)
    this.options.onUserSocketsDrained(userId)
  }

  // Fan out to every clientId that authenticates with the same `userId`.
  broadcastToUser(userId: string, message: TMessage): void {
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets || sockets.size === 0) return
    const payload = this.serializeMessage(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  protected serializeMessage(message: TMessage): string {
    return JSON.stringify(message)
  }

  isClientOnline(userId: string, clientId: string): boolean {
    return (this.socketCountByClientKey.get(userClientKey(userId, clientId)) ?? 0) > 0
  }

  hasUserSockets(userId: string): boolean {
    return (this.socketsByUserId.get(userId)?.size ?? 0) > 0
  }

  hasOnlineUserClients(userId: string): boolean {
    for (const [clientKey, socketCount] of this.socketCountByClientKey) {
      if (socketCount === 0) continue
      if (splitUserClientKey(clientKey).userId === userId) return true
    }
    return false
  }

  socketCount(): number {
    let total = 0
    for (const sockets of this.socketsByUserId.values()) total += sockets.size
    return total
  }

  disconnectAll(): void {
    clearInterval(this.heartbeatTimer)
    for (const sockets of Array.from(this.socketsByUserId.values())) {
      for (const socket of Array.from(sockets)) {
        try {
          if (socket.forceClose) socket.forceClose(1001, this.options.shutdownReason)
          else socket.close(1001, this.options.shutdownReason)
        } catch {}
      }
    }
    this.socketsByUserId.clear()
    this.socketMetaBySocket.clear()
    this.socketCountByClientKey.clear()
  }

  private emitPresence(clientKey: string, previousOnline: boolean, online: boolean): void {
    const { userId, clientId } = splitUserClientKey(clientKey)
    this.options.onClientPresenceChanged({ clientId, userId, previousOnline, online })
  }

  private closeSocket(socket: RealtimeSocket, code?: number, reason?: string): void {
    try {
      if (socket.forceClose) socket.forceClose(code, reason)
      else socket.close(code, reason)
    } catch {}
    this.unregisterSocket(socket)
  }

  private sendOrUnregister(socket: RealtimeSocket, payload: string): void {
    try {
      socket.send(payload)
    } catch {
      this.unregisterSocket(socket)
    }
  }
}

function userClientKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`
}

function splitUserClientKey(key: string): { userId: string; clientId: string } {
  const idx = key.indexOf('\0')
  if (idx < 0) return { userId: key, clientId: '' }
  return { userId: key.slice(0, idx), clientId: key.slice(idx + 1) }
}
