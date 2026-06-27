import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

export interface TerminalRealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface TerminalBrokerOptions {
  onClientConnected(clientId: string, userId: string): void
  onClientDisconnected(clientId: string, userId: string): void
  onUserDisconnected(userId: string): void
}

/**
 * Client is expected to send a heartbeat every
 * `HEARTBEAT_INTERVAL_MS` (30 s). If a `(userId, clientId)` goes
 * silent for `HEARTBEAT_DEADLINE_MS` (90 s) the broker fires a
 * synthetic `onClientDisconnected` so the next `attach` from a
 * sibling can auto-claim. Without this, a controller whose process
 * died but whose OS socket is still in `ESTABLISHED` would strand
 * siblings in viewer mode for as long as the OS keeps the half-open
 * socket alive (laptop sleep, OS kill, NIC never notified).
 *
 * The actual disconnect latency is `HEARTBEAT_DEADLINE_MS +
 * HEARTBEAT_INTERVAL_MS` = 120 s in the worst case: if a beat lands
 * at t=89.9 s, the next scan at t=90 s sees the deadline as
 * unbreached; the scan at t=120 s (the next `setInterval` tick)
 * finally fires. The 90 s figure is the *guaranteed* floor; 120 s
 * is the observed upper bound.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000
export const HEARTBEAT_DEADLINE_MS = 90_000

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByUserId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<TerminalRealtimeSocket, { clientId: string; userId: string }>()
  private readonly socketCountByUserClientKey = new Map<string, number>()
  private readonly lastHeartbeatAtByClientKey = new Map<string, number>()
  // Tracks clientKeys whose `onClientDisconnected` has been fired
  // by the heartbeat scan. `unregisterSocket` consults this set
  // to avoid double-firing the same event when the OS eventually
  // closes the half-open socket. Cleared on the next `registerSocket`.
  private readonly syntheticDisconnectedKeys = new Set<string>()
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
    // A fresh registration clears any synthetic-disconnected
    // marker from a prior session so the next `unregisterSocket`
    // for this clientKey is treated as a normal disconnect, not
    // a duplicate of a previously-fired synthetic one.
    this.syntheticDisconnectedKeys.delete(clientKey)
    const nextCount = (this.socketCountByUserClientKey.get(clientKey) ?? 0) + 1
    this.socketCountByUserClientKey.set(clientKey, nextCount)
    // Seed the heartbeat clock to "now" so the client is never
    // racing the deadline before its first beat lands. The first
    // real `recordHeartbeat` will overwrite this anyway.
    this.lastHeartbeatAtByClientKey.set(clientKey, Date.now())
    if (nextCount === 1) this.options.onClientConnected(clientId, userId)
  }

  /**
   * Update the last-heartbeat timestamp for `(userId, clientId)`.
   * Idempotent and cheap; called by the runtime on every client
   * heartbeat. The deadline check is driven by `scanHeartbeats` on
   * the broker's own `setInterval`, not on each call.
   */
  recordHeartbeat(userId: string, clientId: string, at: number): void {
    const clientKey = userClientKey(userId, clientId)
    if (!this.socketCountByUserClientKey.has(clientKey)) return
    // Reject malformed `at` values: a non-finite number would
    // poison `Date.now() - lastBeat` in `scanHeartbeats` (yielding
    // `NaN`, which fails the `< HEARTBEAT_DEADLINE_MS` check and
    // drops the client immediately). A future-dated `at` (clock
    // skew after laptop wake, or a hostile client) would also
    // look like "stale" and trigger a premature synthetic
    // disconnect. Clamp the upper bound to "now + 60 s" (generous
    // slack for a slowly-synced client clock); clamp the lower
    // bound to `lastBeat ?? 0` so a backwards-clock skew never
    // resets the deadline.
    if (!Number.isFinite(at)) return
    const clampedAt = Math.min(Math.max(at, this.lastHeartbeatAtByClientKey.get(clientKey) ?? 0), Date.now() + 60_000)
    this.lastHeartbeatAtByClientKey.set(clientKey, clampedAt)
  }

  /**
   * Walk the per-client heartbeat clock and fire synthetic
   * disconnects for any `(userId, clientId)` whose last beat is
   * older than `HEARTBEAT_DEADLINE_MS`. The reconnection case (the
   * socket still up, the client just got back) is covered
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
      this.syntheticDisconnectedKeys.add(clientKey)
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
      // Skip the second `onClientDisconnected` if the heartbeat
      // scan already fired it for this clientKey. A late OS-level
      // close on a half-open socket would otherwise re-emit the
      // event, confusing sibling windows and the catalog
      // reconciliation log.
      if (!this.syntheticDisconnectedKeys.delete(clientKey)) {
        this.options.onClientDisconnected(clientId, userId)
      }
    } else this.socketCountByUserClientKey.set(clientKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByUserId.delete(userId)
    this.options.onUserDisconnected(userId)
  }

  // Fan out to every clientId that authenticates with the same
  // `userId`. This is the cross-tab path: when the live PTY
  // produces an output event under one clientId, a sibling tab
  // (same access token, different `clientId` from sessionStorage)
  // receives the same event without needing a new attach roundtrip.
  // The terminal sink callback decides which event type triggers
  // this fanout (output, title, exit, identity).
  broadcastToUser(userId: string, message: TerminalRealtimeMessage): void {
    const sockets = this.socketsByUserId.get(userId)
    if (!sockets || sockets.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  /**
   * `true` iff the broker has a live socket for `(userId, clientId)`
   * AND the client has heartbeated within the deadline. Sockets
   * whose client has died but whose OS half-open connection is
   * still in `ESTABLISHED` are reported as disconnected so the
   * next attach can auto-claim.
   */
  isClientConnected(userId: string, clientId?: string): boolean | undefined {
    if (!clientId) return undefined
    const clientKey = userClientKey(userId, clientId)
    if ((this.socketCountByUserClientKey.get(clientKey) ?? 0) === 0) return false
    const lastBeat = this.lastHeartbeatAtByClientKey.get(clientKey)
    // A registered socket that has never heartbeated (e.g. the
    // client was killed before its first beat) is treated as
    // disconnected. The deadline-anchor seeded by `registerSocket`
    // is "now" so this only fires for the race between register
    // and the first real beat.
    if (lastBeat === undefined) return false
    return Date.now() - lastBeat < HEARTBEAT_DEADLINE_MS
  }

  hasUserSockets(userId: string): boolean {
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
    this.syntheticDisconnectedKeys.clear()
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
