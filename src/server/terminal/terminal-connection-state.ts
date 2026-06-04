interface TerminalConnectionStateOptions {
  ownershipGraceMs: number
  detachedTtlMs: number
  onOwnershipRelease(clientId: string, attachmentId: string): void
  onClientExpired(clientId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

export class TerminalConnectionState {
  private readonly ownershipTimerByAttachmentKey = new Map<string, TimerHandle>()
  private readonly disconnectTimerByClientId = new Map<string, TimerHandle>()

  constructor(private readonly options: TerminalConnectionStateOptions) {}

  clearAttachmentDisconnect(clientId: string, attachmentId: string): void {
    this.clearOwnershipTimerByKey(terminalAttachmentKey(clientId, attachmentId))
  }

  clearClientDisconnect(clientId: string): void {
    const timer = this.disconnectTimerByClientId.get(clientId)
    if (!timer) return
    clearTimeout(timer)
    this.disconnectTimerByClientId.delete(clientId)
  }

  scheduleOwnershipRelease(clientId: string, attachmentId: string, stillConnected: () => boolean): void {
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    this.clearOwnershipTimerByKey(attachmentKey)
    this.ownershipTimerByAttachmentKey.set(
      attachmentKey,
      setTimeout(() => {
        this.ownershipTimerByAttachmentKey.delete(attachmentKey)
        if (stillConnected()) return
        this.options.onOwnershipRelease(clientId, attachmentId)
      }, this.options.ownershipGraceMs),
    )
  }

  scheduleClientDisconnect(clientId: string, hasSockets: () => boolean): void {
    this.clearClientDisconnect(clientId)
    this.disconnectTimerByClientId.set(
      clientId,
      setTimeout(() => {
        this.disconnectTimerByClientId.delete(clientId)
        if (hasSockets()) return
        this.options.onClientExpired(clientId)
      }, this.options.detachedTtlMs),
    )
  }

  shutdown(): void {
    for (const timer of this.ownershipTimerByAttachmentKey.values()) clearTimeout(timer)
    for (const timer of this.disconnectTimerByClientId.values()) clearTimeout(timer)
    this.ownershipTimerByAttachmentKey.clear()
    this.disconnectTimerByClientId.clear()
  }

  private clearOwnershipTimerByKey(attachmentKey: string): void {
    const timer = this.ownershipTimerByAttachmentKey.get(attachmentKey)
    if (!timer) return
    clearTimeout(timer)
    this.ownershipTimerByAttachmentKey.delete(attachmentKey)
  }
}

function terminalAttachmentKey(clientId: string, attachmentId: string): string {
  return `${clientId}\0${attachmentId}`
}
