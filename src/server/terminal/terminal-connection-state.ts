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
  onOwnerExpired(userId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

interface OwnerTimerEntry {
  timer: TimerHandle
  userId: string
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
  private readonly disconnectTimerByUserId = new Map<string, OwnerTimerEntry>()

  constructor(options: TerminalConnectionStateOptions) {
    this.options = options
  }

  clearOwnerDisconnect(userId: string): void {
    const entry = this.disconnectTimerByUserId.get(userId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.disconnectTimerByUserId.delete(userId)
  }

  scheduleOwnerDisconnect(userId: string, hasSockets: () => boolean): void {
    this.clearOwnerDisconnect(userId)
    const entry: OwnerTimerEntry = {
      userId,
      timer: setTimeout(() => {
        this.disconnectTimerByUserId.delete(userId)
        if (hasSockets()) return
        this.options.onOwnerExpired(userId)
      }, this.options.detachedTtlMs),
    }
    this.disconnectTimerByUserId.set(userId, entry)
  }

  shutdown(): void {
    for (const entry of this.disconnectTimerByUserId.values()) clearTimeout(entry.timer)
    this.disconnectTimerByUserId.clear()
  }
}
