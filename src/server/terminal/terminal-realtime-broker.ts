import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

export interface TerminalRealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface TerminalBrokerOptions {
  onAttachmentConnected(clientId: string, attachmentId: string, ownerId: string): void
  onAttachmentDisconnected(clientId: string, attachmentId: string, ownerId: string): void
  onOwnerDisconnected(ownerId: string): void
}

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByOwnerId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<
    TerminalRealtimeSocket,
    { clientId: string; attachmentId: string; ownerId: string }
  >()
  private readonly socketCountByOwnerAttachmentKey = new Map<string, number>()

  constructor(options: TerminalBrokerOptions) {
    this.options = options
  }

  registerSocket(clientId: string, attachmentId: string, ownerId: string, socket: TerminalRealtimeSocket): void {
    if (this.socketMetaBySocket.has(socket)) this.unregisterSocket(socket)
    let sockets = this.socketsByOwnerId.get(ownerId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByOwnerId.set(ownerId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, attachmentId, ownerId })
    const attachmentKey = ownerAttachmentKey(ownerId, attachmentId)
    const nextCount = (this.socketCountByOwnerAttachmentKey.get(attachmentKey) ?? 0) + 1
    this.socketCountByOwnerAttachmentKey.set(attachmentKey, nextCount)
    if (nextCount === 1) this.options.onAttachmentConnected(clientId, attachmentId, ownerId)
  }

  unregisterSocket(socket: TerminalRealtimeSocket): void {
    const meta = this.socketMetaBySocket.get(socket)
    if (!meta) return
    const { clientId, attachmentId, ownerId } = meta
    const sockets = this.socketsByOwnerId.get(ownerId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const attachmentKey = ownerAttachmentKey(ownerId, attachmentId)
    const nextCount = Math.max(0, (this.socketCountByOwnerAttachmentKey.get(attachmentKey) ?? 0) - 1)
    if (nextCount === 0) {
      this.socketCountByOwnerAttachmentKey.delete(attachmentKey)
      this.options.onAttachmentDisconnected(clientId, attachmentId, ownerId)
    } else this.socketCountByOwnerAttachmentKey.set(attachmentKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByOwnerId.delete(ownerId)
    this.options.onOwnerDisconnected(ownerId)
  }

  // Fan out to every clientId that authenticates with the same
  // `ownerId`. This is the cross-tab path: when the live PTY
  // produces an output event under one clientId, a sibling tab
  // (same access token, different `clientId` from localStorage)
  // receives the same event without needing a new attach roundtrip.
  // The terminal sink callback decides which event type triggers
  // this fanout (output, title, exit, ownership).
  broadcastToOwner(ownerId: string, message: TerminalRealtimeMessage): void {
    const sockets = this.socketsByOwnerId.get(ownerId)
    if (!sockets || sockets.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  isAttachmentConnected(ownerId: string, attachmentId?: string): boolean | undefined {
    if (!attachmentId) return undefined
    return (this.socketCountByOwnerAttachmentKey.get(ownerAttachmentKey(ownerId, attachmentId)) ?? 0) > 0
  }

  hasOwnerSockets(ownerId: string): boolean {
    return (this.socketsByOwnerId.get(ownerId)?.size ?? 0) > 0
  }

  socketCount(): number {
    let total = 0
    for (const sockets of this.socketsByOwnerId.values()) total += sockets.size
    return total
  }

  disconnectAll(): void {
    for (const sockets of this.socketsByOwnerId.values()) {
      for (const socket of Array.from(sockets)) {
        try {
          socket.close(1001, 'server shutting down')
        } catch {}
      }
    }
    this.socketsByOwnerId.clear()
    this.socketMetaBySocket.clear()
    this.socketCountByOwnerAttachmentKey.clear()
  }

  private sendOrUnregister(socket: TerminalRealtimeSocket, payload: string): void {
    try {
      socket.send(payload)
    } catch {
      this.unregisterSocket(socket)
    }
  }
}

function ownerAttachmentKey(ownerId: string, attachmentId: string): string {
  return `${ownerId}\0${attachmentId}`
}
