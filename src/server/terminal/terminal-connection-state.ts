interface TerminalConnectionStateOptions {
  ownershipGraceMs: number
  detachedTtlMs: number
  onAttachmentExpired(ownerId: string, attachmentId: string): void
  onOwnerExpired(ownerId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

interface OwnershipTimerEntry {
  timer: TimerHandle
  ownerId: string
  attachmentId: string
}

interface OwnerTimerEntry {
  timer: TimerHandle
  ownerId: string
}

export class TerminalConnectionState {
  private readonly options: TerminalConnectionStateOptions
  private readonly ownershipTimerByAttachmentKey = new Map<string, OwnershipTimerEntry>()
  private readonly disconnectTimerByOwnerId = new Map<string, OwnerTimerEntry>()

  constructor(options: TerminalConnectionStateOptions) {
    this.options = options
  }

  clearAttachmentDisconnect(ownerId: string, attachmentId: string): void {
    this.clearOwnershipTimerByKey(ownerAttachmentKey(ownerId, attachmentId))
  }

  clearOwnerDisconnect(ownerId: string): void {
    const entry = this.disconnectTimerByOwnerId.get(ownerId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.disconnectTimerByOwnerId.delete(ownerId)
  }

  scheduleOwnershipRelease(ownerId: string, attachmentId: string, stillConnected: () => boolean): void {
    const attachmentKey = ownerAttachmentKey(ownerId, attachmentId)
    this.clearOwnershipTimerByKey(attachmentKey)
    const entry: OwnershipTimerEntry = {
      ownerId,
      attachmentId,
      timer: setTimeout(() => {
        this.ownershipTimerByAttachmentKey.delete(attachmentKey)
        if (stillConnected()) return
        this.options.onAttachmentExpired(ownerId, attachmentId)
      }, this.options.ownershipGraceMs),
    }
    this.ownershipTimerByAttachmentKey.set(attachmentKey, entry)
  }

  scheduleOwnerDisconnect(ownerId: string, hasSockets: () => boolean): void {
    this.clearOwnerDisconnect(ownerId)
    const entry: OwnerTimerEntry = {
      ownerId,
      timer: setTimeout(() => {
        this.disconnectTimerByOwnerId.delete(ownerId)
        if (hasSockets()) return
        this.options.onOwnerExpired(ownerId)
      }, this.options.detachedTtlMs),
    }
    this.disconnectTimerByOwnerId.set(ownerId, entry)
  }

  shutdown(): void {
    for (const entry of this.ownershipTimerByAttachmentKey.values()) clearTimeout(entry.timer)
    for (const entry of this.disconnectTimerByOwnerId.values()) clearTimeout(entry.timer)
    this.ownershipTimerByAttachmentKey.clear()
    this.disconnectTimerByOwnerId.clear()
  }

  private clearOwnershipTimerByKey(attachmentKey: string): void {
    const entry = this.ownershipTimerByAttachmentKey.get(attachmentKey)
    if (!entry) return
    clearTimeout(entry.timer)
    this.ownershipTimerByAttachmentKey.delete(attachmentKey)
  }
}

function ownerAttachmentKey(ownerId: string, attachmentId: string): string {
  return `${ownerId}\0${attachmentId}`
}
