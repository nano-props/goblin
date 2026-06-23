interface TerminalConnectionStateOptions {
  /**
   * Time after the owner's last socket disconnects before the
   * server-side sessions owned by that owner are torn down entirely
   * (PTY exit, view-order purge). This is unrelated to terminal
   * ownership grace — by the time it fires the owner is presumed to
   * have moved on. Keep it long enough that an end-of-day quit-then-
   * resume doesn't lose the session catalog.
   */
  detachedTtlMs: number
  onOwnerExpired(ownerId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

interface OwnerTimerEntry {
  timer: TimerHandle
  ownerId: string
}

/**
 * Tracks the per-owner detached TTL. The previous revision also
 * managed a per-attachment ownership grace timer (30 s after a
 * controller's socket dropped) — that timer has been removed: the
 * server now clears the controller slot on disconnect and the next
 * attach auto-claims (see `terminal-ownership.ts`).
 */
export class TerminalConnectionState {
  private readonly options: TerminalConnectionStateOptions
  private readonly disconnectTimerByOwnerId = new Map<string, OwnerTimerEntry>()

  constructor(options: TerminalConnectionStateOptions) {
    this.options = options
  }

  clearOwnerDisconnect(ownerId: string): void {
    const entry = this.disconnectTimerByOwnerId.get(ownerId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.disconnectTimerByOwnerId.delete(ownerId)
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
    for (const entry of this.disconnectTimerByOwnerId.values()) clearTimeout(entry.timer)
    this.disconnectTimerByOwnerId.clear()
  }
}
