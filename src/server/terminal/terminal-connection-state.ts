interface TerminalConnectionStateOptions {
  ownershipGraceMs: number
  detachedTtlMs: number
  // Timer callbacks now carry `ownerId` so the coordinator can
  // reach the ownerId-partitioned session manager without having
  // to re-derive identity from the (clientId, attachmentId) key
  // that the timer is indexed under.
  onAttachmentExpired(clientId: string, attachmentId: string, ownerId: string): void
  onClientExpired(clientId: string, ownerId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

interface OwnershipTimerEntry {
  timer: TimerHandle
  clientId: string
  attachmentId: string
  ownerId: string
}

interface ClientTimerEntry {
  timer: TimerHandle
  clientId: string
  ownerId: string
}

export class TerminalConnectionState {
  private readonly options: TerminalConnectionStateOptions
  private readonly ownershipTimerByAttachmentKey = new Map<string, OwnershipTimerEntry>()
  private readonly disconnectTimerByClientId = new Map<string, ClientTimerEntry>()

  constructor(options: TerminalConnectionStateOptions) {
    this.options = options
  }

  clearAttachmentDisconnect(clientId: string, attachmentId: string): void {
    this.clearOwnershipTimerByKey(terminalAttachmentKey(clientId, attachmentId))
  }

  clearClientDisconnect(clientId: string): void {
    const entry = this.disconnectTimerByClientId.get(clientId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.disconnectTimerByClientId.delete(clientId)
  }

  scheduleOwnershipRelease(
    clientId: string,
    attachmentId: string,
    ownerId: string,
    stillConnected: () => boolean,
  ): void {
    const attachmentKey = terminalAttachmentKey(clientId, attachmentId)
    this.clearOwnershipTimerByKey(attachmentKey)
    const entry: OwnershipTimerEntry = {
      clientId,
      attachmentId,
      ownerId,
      timer: setTimeout(() => {
        this.ownershipTimerByAttachmentKey.delete(attachmentKey)
        if (stillConnected()) return
        this.options.onAttachmentExpired(clientId, attachmentId, ownerId)
      }, this.options.ownershipGraceMs),
    }
    this.ownershipTimerByAttachmentKey.set(attachmentKey, entry)
  }

  scheduleClientDisconnect(clientId: string, ownerId: string, hasSockets: () => boolean): void {
    this.clearClientDisconnect(clientId)
    const entry: ClientTimerEntry = {
      clientId,
      ownerId,
      timer: setTimeout(() => {
        this.disconnectTimerByClientId.delete(clientId)
        if (hasSockets()) return
        this.options.onClientExpired(clientId, ownerId)
      }, this.options.detachedTtlMs),
    }
    this.disconnectTimerByClientId.set(clientId, entry)
  }

  shutdown(): void {
    for (const entry of this.ownershipTimerByAttachmentKey.values()) clearTimeout(entry.timer)
    for (const entry of this.disconnectTimerByClientId.values()) clearTimeout(entry.timer)
    this.ownershipTimerByAttachmentKey.clear()
    this.disconnectTimerByClientId.clear()
  }

  private clearOwnershipTimerByKey(attachmentKey: string): void {
    const entry = this.ownershipTimerByAttachmentKey.get(attachmentKey)
    if (!entry) return
    clearTimeout(entry.timer)
    this.ownershipTimerByAttachmentKey.delete(attachmentKey)
  }
}

function terminalAttachmentKey(clientId: string, attachmentId: string): string {
  return `${clientId}\0${attachmentId}`
}
