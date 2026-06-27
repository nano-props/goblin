interface TerminalDetachedUserTimerOptions {
  /**
   * Time after the user's last socket disconnects before the
   * server-side sessions owned by that user are torn down entirely
   * (PTY exit, view-order purge). This is unrelated to terminal
   * controller grace — by the time it fires the controller is presumed to
   * have moved on. Keep it long enough that an end-of-day quit-then-
   * resume doesn't lose the session catalog.
   */
  detachedTtlMs: number
  onUserExpired(userId: string): void
}

type TimerHandle = ReturnType<typeof setTimeout>

interface UserTimerEntry {
  timer: TimerHandle
  userId: string
}

/**
 * Tracks the per-user detached TTL. The previous revision also
 * managed a per-attachment controller grace timer (30 s after a
 * controller's socket dropped) — that timer has been removed: the
 * server now clears the controller role on disconnect and the next
 * attach auto-claims (see `terminal-controller.ts`).
 */
export class TerminalDetachedUserTimer {
  private readonly options: TerminalDetachedUserTimerOptions
  private readonly disconnectTimerByUserId = new Map<string, UserTimerEntry>()

  constructor(options: TerminalDetachedUserTimerOptions) {
    this.options = options
  }

  clearUserDisconnect(userId: string): void {
    const entry = this.disconnectTimerByUserId.get(userId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.disconnectTimerByUserId.delete(userId)
  }

  scheduleUserDisconnect(userId: string, hasSockets: () => boolean): void {
    this.clearUserDisconnect(userId)
    const entry: UserTimerEntry = {
      userId,
      timer: setTimeout(() => {
        this.disconnectTimerByUserId.delete(userId)
        if (hasSockets()) return
        this.options.onUserExpired(userId)
      }, this.options.detachedTtlMs),
    }
    this.disconnectTimerByUserId.set(userId, entry)
  }

  shutdown(): void {
    for (const entry of this.disconnectTimerByUserId.values()) clearTimeout(entry.timer)
    this.disconnectTimerByUserId.clear()
  }
}
