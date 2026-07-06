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
 * `REALTIME_HEARTBEAT_INTERVAL_MS` (30 s). If a `(userId, clientId)` goes
 * silent for `REALTIME_HEARTBEAT_DEADLINE_MS` (90 s), transport-owned
 * presence flips offline and the stale sockets for that client are closed.
 * A reconnect registers fresh sockets and flips presence online again.
 *
 * The actual silence detection latency is `REALTIME_HEARTBEAT_DEADLINE_MS +
 * REALTIME_HEARTBEAT_INTERVAL_MS` = 120 s in the worst case: if a beat lands
 * at t=89.9 s, the next scan at t=90 s sees the deadline as unbreached; the
 * scan at t=120 s finally fires.
 */
export const REALTIME_HEARTBEAT_INTERVAL_MS = 30_000
export const REALTIME_HEARTBEAT_DEADLINE_MS = 90_000

interface ClientPresenceRecord {
  socketCount: number
  lastHeartbeatAt: number
  online: boolean
}

export class RealtimeBroker<TMessage> {
  private readonly options: Required<RealtimeBrokerOptions>
  private readonly socketsByUserId = new Map<string, Set<RealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<RealtimeSocket, { clientId: string; userId: string }>()
  private readonly presenceByClientKey = new Map<string, ClientPresenceRecord>()
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
    let sockets = this.socketsByUserId.get(userId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByUserId.set(userId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, userId })
    const clientKey = userClientKey(userId, clientId)
    const existing = this.presenceByClientKey.get(clientKey)
    if (existing) {
      existing.socketCount += 1
      existing.lastHeartbeatAt = Date.now()
      if (!existing.online) this.setClientPresence(clientKey, true)
      return
    }
    this.presenceByClientKey.set(clientKey, {
      socketCount: 1,
      lastHeartbeatAt: Date.now(),
      online: true,
    })
    this.emitPresence(clientKey, false, true)
  }

  /** Update the last-heartbeat receipt time for `(userId, clientId)`. */
  recordHeartbeat(userId: string, clientId: string): void {
    const clientKey = userClientKey(userId, clientId)
    const record = this.presenceByClientKey.get(clientKey)
    if (!record || record.socketCount === 0) return
    record.lastHeartbeatAt = Date.now()
    if (!record.online) this.setClientPresence(clientKey, true)
  }

  private scanHeartbeats(): void {
    const now = Date.now()
    for (const [clientKey, record] of Array.from(this.presenceByClientKey)) {
      if (!record.online) continue
      if (record.socketCount === 0) continue
      if (now - record.lastHeartbeatAt < REALTIME_HEARTBEAT_DEADLINE_MS) continue
      this.closeClientSockets(clientKey, 1001, this.options.heartbeatTimeoutReason)
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
    const record = this.presenceByClientKey.get(clientKey)
    if (record) {
      record.socketCount = Math.max(0, record.socketCount - 1)
      if (record.socketCount === 0) {
        const wasOnline = record.online
        this.presenceByClientKey.delete(clientKey)
        if (wasOnline) this.emitPresence(clientKey, true, false)
      }
    }
    if (sockets.size > 0) return
    this.socketsByUserId.delete(userId)
    this.options.onUserSocketsDrained(userId)
  }

  // Fan out to every clientId that authenticates with the same `userId`.
  broadcastToUser(userId: string, message: TMessage): void {
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets || sockets.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  isClientOnline(userId: string, clientId: string): boolean {
    return this.presenceByClientKey.get(userClientKey(userId, clientId))?.online ?? false
  }

  hasUserSockets(userId: string): boolean {
    return (this.socketsByUserId.get(userId)?.size ?? 0) > 0
  }

  hasOnlineUserClients(userId: string): boolean {
    for (const [clientKey, record] of this.presenceByClientKey) {
      if (!record.online) continue
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
    this.presenceByClientKey.clear()
  }

  private setClientPresence(clientKey: string, online: boolean): void {
    const record = this.presenceByClientKey.get(clientKey)
    if (!record || record.online === online) return
    const previousOnline = record.online
    record.online = online
    this.emitPresence(clientKey, previousOnline, online)
  }

  private emitPresence(clientKey: string, previousOnline: boolean, online: boolean): void {
    const { userId, clientId } = splitUserClientKey(clientKey)
    this.options.onClientPresenceChanged({ clientId, userId, previousOnline, online })
  }

  private closeClientSockets(clientKey: string, code?: number, reason?: string): void {
    const { userId, clientId } = splitUserClientKey(clientKey)
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets) return
    for (const socket of Array.from(sockets)) {
      const meta = this.socketMetaBySocket.get(socket)
      if (meta?.clientId !== clientId) continue
      try {
        if (socket.forceClose) socket.forceClose(code, reason)
        else socket.close(code, reason)
      } catch {}
      this.unregisterSocket(socket)
    }
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
