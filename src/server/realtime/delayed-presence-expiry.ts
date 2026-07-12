type TimerHandle = ReturnType<typeof setTimeout>

interface DelayedPresenceExpiryEntry {
  timer: TimerHandle
}

/**
 * Converts an edge-triggered presence signal into a renewable lease.
 *
 * The realtime broker remains the sole authority for whether a principal is
 * currently present. This class owns only the grace period between confirmed
 * absence and domain cleanup; it never polls or maintains a second presence
 * model.
 */
export class DelayedPresenceExpiry<Key> {
  private readonly delayMs: number
  private readonly entries = new Map<Key, DelayedPresenceExpiryEntry>()

  constructor(delayMs: number) {
    this.delayMs = delayMs
  }

  cancel(key: Key): void {
    const entry = this.entries.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    this.entries.delete(key)
  }

  has(key: Key): boolean {
    return this.entries.has(key)
  }

  schedule(key: Key, isPresent: () => boolean, onExpired: () => void): void {
    this.cancel(key)
    const entry: DelayedPresenceExpiryEntry = {
      timer: setTimeout(() => {
        this.entries.delete(key)
        if (!isPresent()) onExpired()
      }, this.delayMs),
    }
    this.entries.set(key, entry)
  }

  shutdown(): void {
    for (const entry of this.entries.values()) clearTimeout(entry.timer)
    this.entries.clear()
  }
}
