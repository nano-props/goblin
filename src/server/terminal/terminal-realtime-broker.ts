import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

export interface TerminalRealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface TerminalBrokerOptions {
  onAttachmentConnected(clientId: string, attachmentId: string, ownerId: string): void
  onAttachmentDisconnected(clientId: string, attachmentId: string, ownerId: string): void
  onClientDisconnected(clientId: string, ownerId: string): void
}

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByClientId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new WeakMap<
    TerminalRealtimeSocket,
    { clientId: string; attachmentId: string; ownerId: string }
  >()
  private readonly socketCountByAttachmentKey = new Map<string, number>()
  // Reverse index: ownerId -> set of clientIds that share it. Used
  // by `broadcastOwner` to fan out a single live event to every
  // browser tab that authenticates with the same access token. We
  // do not store the ownerId on the per-client Set (a clientId is
  // owned by exactly one ownerId — Electron's `clientId` and
  // Chrome's `clientId` are distinct even when both authenticate
  // with the same token) so the mapping is one-to-many in the
  // ownerId direction only.
  private readonly clientIdsByOwnerId = new Map<string, Set<string>>()

  constructor(options: TerminalBrokerOptions) {
    this.options = options
  }

  registerSocket(
    clientId: string,
    attachmentId: string,
    ownerId: string,
    socket: TerminalRealtimeSocket,
  ): void {
    let sockets = this.socketsByClientId.get(clientId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByClientId.set(clientId, sockets)
      // A new clientId is associated with exactly one ownerId. If a
      // stale entry exists (it shouldn't, because the previous
      // owner's last socket would have cleared the empty set), drop
      // it first so the reverse index never points at a clientId
      // that the forward index has forgotten.
      for (const ids of this.clientIdsByOwnerId.values()) ids.delete(clientId)
      let ownerClients = this.clientIdsByOwnerId.get(ownerId)
      if (!ownerClients) {
        ownerClients = new Set()
        this.clientIdsByOwnerId.set(ownerId, ownerClients)
      }
      ownerClients.add(clientId)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, attachmentId, ownerId })
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    const nextCount = (this.socketCountByAttachmentKey.get(attachmentKey) ?? 0) + 1
    this.socketCountByAttachmentKey.set(attachmentKey, nextCount)
    if (nextCount === 1) this.options.onAttachmentConnected(clientId, attachmentId, ownerId)
  }

  unregisterSocket(clientId: string, attachmentId: string, ownerId: string, socket: TerminalRealtimeSocket): void {
    const sockets = this.socketsByClientId.get(clientId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    const nextCount = Math.max(0, (this.socketCountByAttachmentKey.get(attachmentKey) ?? 0) - 1)
    if (nextCount === 0) {
      this.socketCountByAttachmentKey.delete(attachmentKey)
      this.options.onAttachmentDisconnected(clientId, attachmentId, ownerId)
    } else this.socketCountByAttachmentKey.set(attachmentKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByClientId.delete(clientId)
    this.options.onClientDisconnected(clientId, ownerId)
    // Last socket for this clientId is gone — drop it from the
    // reverse index too, otherwise stale clientIds would accumulate
    // and `broadcastOwner` would attempt to send to dead sockets.
    const ownerClients = this.clientIdsByOwnerId.get(ownerId)
    if (ownerClients) {
      ownerClients.delete(clientId)
      if (ownerClients.size === 0) this.clientIdsByOwnerId.delete(ownerId)
    }
  }

  broadcast(clientId: string, message: TerminalRealtimeMessage): void {
    const payload = JSON.stringify(message)
    const sockets = this.socketsByClientId.get(clientId)
    if (!sockets || sockets.size === 0) return
    // Per-message payload size is not capped here; the de-facto cap is the
    // PTY write rate × MAX_TERMINAL_WRITE_CHARS (1 MiB per write) and the
    // render buffer cap MAX_BUFFER_CHARS (16 MiB). A single 16 MiB chunk
    // would be sent verbatim; the WebSocket frame size cap on the receiving
    // side is what ultimately bounds it. If output throughput becomes a
    // concern, add a fragmenting writer here.
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  // Fan out to every clientId that authenticates with the same
  // `ownerId`. This is the cross-tab path: when the live PTY
  // produces an output event under one clientId, a sibling tab
  // (same access token, different `clientId` from localStorage)
  // receives the same event without needing a new attach roundtrip.
  // The terminal sink callback decides which event type triggers
  // this fanout (output, title, exit, ownership).
  broadcastOwner(ownerId: string, message: TerminalRealtimeMessage): void {
    const clientIds = this.clientIdsByOwnerId.get(ownerId)
    if (!clientIds || clientIds.size === 0) return
    const payload = JSON.stringify(message)
    for (const clientId of Array.from(clientIds)) {
      const sockets = this.socketsByClientId.get(clientId)
      if (!sockets) continue
      for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
    }
  }

  broadcastGlobal(message: TerminalRealtimeMessage): void {
    const payload = JSON.stringify(message)
    for (const sockets of this.socketsByClientId.values()) {
      for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
    }
  }

  attachmentIsConnected(clientId: string, attachmentId?: string): boolean | undefined {
    if (!attachmentId) return undefined
    return (this.socketCountByAttachmentKey.get(terminalAttachmentKey(clientId, attachmentId)) ?? 0) > 0
  }

  hasClientSockets(clientId: string): boolean {
    return (this.socketsByClientId.get(clientId)?.size ?? 0) > 0
  }

  socketCount(): number {
    let total = 0
    for (const sockets of this.socketsByClientId.values()) total += sockets.size
    return total
  }

  disconnectAll(): void {
    for (const sockets of this.socketsByClientId.values()) {
      for (const socket of Array.from(sockets)) {
        try {
          socket.close(1001, 'server shutting down')
        } catch {}
      }
    }
    this.socketsByClientId.clear()
    this.socketCountByAttachmentKey.clear()
    this.clientIdsByOwnerId.clear()
  }

  private sendOrUnregister(socket: TerminalRealtimeSocket, payload: string): void {
    try {
      socket.send(payload)
    } catch {
      const meta = this.socketMetaBySocket.get(socket)
      if (meta) this.unregisterSocket(meta.clientId, meta.attachmentId, meta.ownerId, socket)
    }
  }
}

function terminalAttachmentKey(clientId: string, attachmentId: string): string {
  return `${clientId}\0${attachmentId}`
}
