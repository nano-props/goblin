import type { TerminalRealtimeMessage } from '#/shared/terminal.ts'

export interface TerminalRealtimeSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

interface TerminalBrokerOptions {
  onAttachmentConnected(clientId: string, attachmentId: string): void
  onAttachmentDisconnected(clientId: string, attachmentId: string): void
  onClientDisconnected(clientId: string): void
}

export class TerminalRealtimeBroker {
  private readonly options: TerminalBrokerOptions
  private readonly socketsByClientId = new Map<string, Set<TerminalRealtimeSocket>>()
  private readonly socketMetaBySocket = new WeakMap<
    TerminalRealtimeSocket,
    { clientId: string; attachmentId: string }
  >()
  private readonly socketCountByAttachmentKey = new Map<string, number>()

  constructor(options: TerminalBrokerOptions) {
    this.options = options
  }

  registerSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
    let sockets = this.socketsByClientId.get(clientId)
    if (!sockets) {
      sockets = new Set()
      this.socketsByClientId.set(clientId, sockets)
    }
    sockets.add(socket)
    this.socketMetaBySocket.set(socket, { clientId, attachmentId })
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    const nextCount = (this.socketCountByAttachmentKey.get(attachmentKey) ?? 0) + 1
    this.socketCountByAttachmentKey.set(attachmentKey, nextCount)
    if (nextCount === 1) this.options.onAttachmentConnected(clientId, attachmentId)
  }

  unregisterSocket(clientId: string, attachmentId: string, socket: TerminalRealtimeSocket): void {
    const sockets = this.socketsByClientId.get(clientId)
    if (!sockets?.has(socket)) return
    sockets.delete(socket)
    this.socketMetaBySocket.delete(socket)
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    const nextCount = Math.max(0, (this.socketCountByAttachmentKey.get(attachmentKey) ?? 0) - 1)
    if (nextCount === 0) {
      this.socketCountByAttachmentKey.delete(attachmentKey)
      this.options.onAttachmentDisconnected(clientId, attachmentId)
    } else this.socketCountByAttachmentKey.set(attachmentKey, nextCount)
    if (sockets.size > 0) return
    this.socketsByClientId.delete(clientId)
    this.options.onClientDisconnected(clientId)
  }

  broadcast(clientId: string, message: TerminalRealtimeMessage): void {
    const payload = JSON.stringify(message)
    const sockets = this.socketsByClientId.get(clientId)
    if (!sockets || sockets.size === 0) return
    for (const socket of Array.from(sockets)) this.sendOrUnregister(socket, payload)
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
  }

  private sendOrUnregister(socket: TerminalRealtimeSocket, payload: string): void {
    try {
      socket.send(payload)
    } catch {
      const meta = this.socketMetaBySocket.get(socket)
      if (meta) this.unregisterSocket(meta.clientId, meta.attachmentId, socket)
    }
  }
}

function terminalAttachmentKey(clientId: string, attachmentId: string): string {
  return `${clientId}\0${attachmentId}`
}
