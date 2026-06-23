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

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByOwnerId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new Map<
    TerminalRealtimeSocket,
    { clientId: string; userId: string }
  >()
  private readonly socketCountByUserClientKey = new Map<string, number>()

  constructor(options: TerminalBrokerOptions) {
    this.options = options
  }

  registerSocket(clientId: string, userId: string, socket: TerminalRealtimeSocket): void {
    if (this.socketMetaBySocket.has(socket)) this.unregisterSocket(socket)
    let sockets = this.socketsByOwnerId.get(userId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByOwnerId.set(userId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, userId })
    const attachmentKey = userClientKey(userId, clientId)
    const nextCount = (this.socketCountByUserClientKey.get(attachmentKey) ?? 0) + 1
    this.socketCountByUserClientKey.set(attachmentKey, nextCount)
    if (nextCount === 1) this.options.onClientConnected(clientId, userId)
  }

  unregisterSocket(socket: TerminalRealtimeSocket): void {
    const meta = this.socketMetaBySocket.get(socket)
    if (!meta) return
    const { clientId, userId } = meta
    const sockets = this.socketsByOwnerId.get(userId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const attachmentKey = userClientKey(userId, clientId)
    const nextCount = Math.max(0, (this.socketCountByUserClientKey.get(attachmentKey) ?? 0) - 1)
    if (nextCount === 0) {
      this.socketCountByUserClientKey.delete(attachmentKey)
      this.options.onClientDisconnected(clientId, userId)
    } else this.socketCountByUserClientKey.set(attachmentKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByOwnerId.delete(userId)
    this.options.onOwnerDisconnected(userId)
  }

  // Fan out to every clientId that authenticates with the same
  // `userId`. This is the cross-tab path: when the live PTY
  // produces an output event under one clientId, a sibling tab
  // (same access token, different `clientId` from localStorage)
  // receives the same event without needing a new attach roundtrip.
  // The terminal sink callback decides which event type triggers
  // this fanout (output, title, exit, ownership).
  broadcastToOwner(userId: string, message: TerminalRealtimeMessage): void {
    const sockets = this.socketsByOwnerId.get(userId)
    if (!sockets || sockets.size === 0) return
    const payload = JSON.stringify(message)
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
  }

  isClientConnected(userId: string, clientId?: string): boolean | undefined {
    if (!clientId) return undefined
    return (this.socketCountByUserClientKey.get(userClientKey(userId, clientId)) ?? 0) > 0
  }

  hasOwnerSockets(userId: string): boolean {
    return (this.socketsByOwnerId.get(userId)?.size ?? 0) > 0
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
    this.socketCountByUserClientKey.clear()
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
