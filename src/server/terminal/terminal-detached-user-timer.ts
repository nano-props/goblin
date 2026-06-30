interface TerminalDetachedUserTimerOptions {
  /**
   * Time after the user has no online terminal clients before the
   * server-side sessions owned by that user are torn down entirely
   * (PTY exit, view-order purge). This is unrelated to terminal
   * controller grace — by the time it fires the controller is presumed to
   * have moved on. Keep it long enough that an end-of-day quit-then-
   * resume doesn't lose the session index.
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
 * controller's socket dropped) — that timer has been removed:
 * broker presence now determines whether a stored controller intent
 * is effective, and the next attach can auto-claim when none is.
 */
export class TerminalDetachedUserTimer {
  private readonly options: TerminalDetachedUserTimerOptions
  private readonly detachedTimerByUserId = new Map<string, UserTimerEntry>()

  constructor(options: TerminalDetachedUserTimerOptions) {
    this.options = options
  }

  clearUserDetachedTimer(userId: string): void {
    const entry = this.detachedTimerByUserId.get(userId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.detachedTimerByUserId.delete(userId)
  }

  hasUserDetachedTimer(userId: string): boolean {
    return this.detachedTimerByUserId.has(userId)
  }

  scheduleUserDetachedTimer(userId: string, hasOnlineClients: () => boolean): void {
    this.clearUserDetachedTimer(userId)
    const entry: UserTimerEntry = {
      userId,
      timer: setTimeout(() => {
        this.detachedTimerByUserId.delete(userId)
        if (hasOnlineClients()) return
        this.options.onUserExpired(userId)
      }, this.options.detachedTtlMs),
    }
    this.detachedTimerByUserId.set(userId, entry)
  }

  shutdown(): void {
    for (const entry of this.detachedTimerByUserId.values()) clearTimeout(entry.timer)
    this.detachedTimerByUserId.clear()
  }
}
