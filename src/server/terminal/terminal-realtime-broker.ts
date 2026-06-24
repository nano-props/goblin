import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

export interface TerminalRealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface TerminalBrokerOptions {
  onClientConnected(clientId: string, userId: string): void
  onClientDisconnected(clientId: string, userId: string): void
  onOwnerDisconnected(userId: string): void
}

/**
 * Renderer is expected to send a heartbeat every
 * `HEARTBEAT_INTERVAL_MS` (30 s). If a `(userId, clientId)` goes
 * silent for `HEARTBEAT_DEADLINE_MS` (90 s) the broker fires a
 * synthetic `onClientDisconnected` so the next `attach` from a
 * sibling can auto-claim. Without this, a controller whose process
 * died but whose OS socket is still in `ESTABLISHED` would strand
 * siblings in viewer mode for as long as the OS keeps the half-open
 * socket alive (laptop sleep, OS kill, NIC never notified).
 */
export const HEARTBEAT_INTERVAL_MS = 30_000
export const HEARTBEAT_DEADLINE_MS = 90_000

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByUserId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<
    TerminalRealtimeSocket,
    { clientId: string; userId: string }
  >()
  private readonly socketCountByUserClientKey = new Map<string, number>()
  private readonly lastHeartbeatAtByClientKey = new Map<string, number>()
  private readonly heartbeatTimer: ReturnType<typeof setInterval>

  constructor(options: TerminalBrokerOptions) {
    this.options = options
    this.heartbeatTimer = setInterval(() => this.scanHeartbeats(), HEARTBEAT_INTERVAL_MS)
    // Unref so a running broker never holds the Node event loop open
    // by itself. The runtime's `disconnectAll` + `shutdown` paths
    // explicitly clear the timer, so this is only a belt-and-suspenders
    // measure for tests that drop the broker on the floor.
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref()
  }

  registerSocket(clientId: string, userId: string, socket: TerminalRealtimeSocket): void {
    if (this.socketMetaBySocket.has(socket)) this.unregisterSocket(socket)
    let sockets = this.socketsByUserId.get(userId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByUserId.set(userId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, userId })
    const clientKey = userClientKey(userId, clientId)
    const nextCount = (this.socketCountByUserClientKey.get(clientKey) ?? 0) + 1
    this.socketCountByUserClientKey.set(clientKey, nextCount)
    // Seed the heartbeat clock to "now" so the renderer is never
    // racing the deadline before its first beat lands. The first
    // real `recordHeartbeat` will overwrite this anyway.
    this.lastHeartbeatAtByClientKey.set(clientKey, Date.now())
    if (nextCount === 1) this.options.onClientConnected(clientId, userId)
  }

  /**
   * Update the last-heartbeat timestamp for `(userId, clientId)`.
   * Idempotent and cheap; called by the runtime on every renderer
   * heartbeat. The deadline check is driven by `scanHeartbeats` on
   * the broker's own `setInterval`, not on each call.
   */
  recordHeartbeat(userId: string, clientId: string, at: number): void {
    const clientKey = userClientKey(userId, clientId)
    if (!this.socketCountByUserClientKey.has(clientKey)) return
    this.lastHeartbeatAtByClientKey.set(clientKey, at)
  }

  /**
   * Walk the per-client heartbeat clock and fire synthetic
   * disconnects for any `(userId, clientId)` whose last beat is
   * older than `HEARTBEAT_DEADLINE_MS`. The reconnection case (the
   * socket still up, the renderer just got back) is covered
   * implicitly: a fresh `registerSocket` resets the timestamp to
   * "now" and `recordHeartbeat` keeps it fresh, so the deadline
   * only fires for truly silent clients.
   *
   * Each fired disconnect is one-shot: the heartbeat entry is
   * dropped so the next scan doesn't fire it again. A later
   * `registerSocket` re-seeds the clock to "now", so a
   * reconnecting client gets a fresh deadline window.
   */
  private scanHeartbeats(): void {
    const now = Date.now()
    for (const [clientKey, lastBeat] of this.lastHeartbeatAtByClientKey) {
      if (now - lastBeat < HEARTBEAT_DEADLINE_MS) continue
      if ((this.socketCountByUserClientKey.get(clientKey) ?? 0) === 0) {
        // No live sockets left; the unregister path already fired
        // `onClientDisconnected`. Drop the stale entry.
        this.lastHeartbeatAtByClientKey.delete(clientKey)
        continue
      }
      const { userId, clientId } = splitUserClientKey(clientKey)
      this.lastHeartbeatAtByClientKey.delete(clientKey)
      this.options.onClientDisconnected(clientId, userId)
    }
  }

  unregisterSocket(socket: TerminalRealtimeSocket): void {
    const meta = this.socketMetaBySocket.get(socket)
    if (!meta) return
    const { clientId, userId } = meta
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const clientKey = userClientKey(userId, clientId)
    const nextCount = Math.max(0, (this.socketCountByUserClientKey.get(clientKey) ?? 0) - 1)
    if (nextCount === 0) {
      this.socketCountByUserClientKey.delete(clientKey)
      this.lastHeartbeatAtByClientKey.delete(clientKey)
      this.options.onClientDisconnected(clientId, userId)
    } else this.socketCountByUserClientKey.set(clientKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByUserId.delete(userId)
    this.options.onOwnerDisconnected(userId)
  }

  // Fan out to every clientId that authenticates with the same
  // `userId`. This is the cross-tab path: when the live PTY
  // produces an output event under one clientId, a sibling tab
  // (same access token, different `clientId` from sessionStorage)
  // receives the same event without needing a new attach roundtrip.
  // The terminal sink callback decides which event type triggers
  // this fanout (output, title, exit, ownership).
  broadcastToOwner(userId: string, message: TerminalRealtimeMessage): void {
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets || sockets.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  isClientConnected(userId: string, clientId?: string): boolean | undefined {
    if (!clientId) return undefined
    return (this.socketCountByUserClientKey.get(userClientKey(userId, clientId)) ?? 0) > 0
  }

  hasOwnerSockets(userId: string): boolean {
    return (this.socketsByUserId.get(userId)?.size ?? 0) > 0
  }

  socketCount(): number {
    let total = 0
    for (const sockets of this.socketsByUserId.values()) total += sockets.size
    return total
  }

  disconnectAll(): void {
    clearInterval(this.heartbeatTimer)
    for (const sockets of this.socketsByUserId.values()) {
      for (const socket of Array.from(sockets)) {
        try {
          socket.close(1001, 'server shutting down')
        } catch {}
      }
    }
    this.socketsByUserId.clear()
    this.socketMetaBySocket.clear()
    this.socketCountByUserClientKey.clear()
    this.lastHeartbeatAtByClientKey.clear()
  }

  private sendOrUnregister(socket: TerminalRealtimeSocket, payload: string): void {
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
