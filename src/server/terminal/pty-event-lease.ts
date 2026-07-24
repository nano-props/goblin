import type { PtyDataEvent, PtyEventLease, PtyEventObserver } from '#/server/terminal/pty-supervisor.ts'

const MAX_PENDING_EVENT_BYTES = 16 * 1024 * 1024
const MAX_PENDING_EVENTS = 65_536

type PtyEvent =
  | { kind: 'data'; event: PtyDataEvent; ownershipTransferBufferedBytes: number }
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }

export interface PtyEventSink {
  data(event: PtyDataEvent): void
  exit(code: number | null, signal: NodeJS.Signals | null): void
}

export interface PtyEventChannel {
  lease: PtyEventLease
  sink: PtyEventSink
}

/**
 * Captures the PTY event stream at the spawn boundary, then transfers it to
 * exactly one business binding without an observer-free gap.
 */
export function createPtyEventChannel(
  maxPendingBytes = MAX_PENDING_EVENT_BYTES,
  maxPendingEvents = MAX_PENDING_EVENTS,
): PtyEventChannel {
  let observer: PtyEventObserver | null = null
  let disposed = false
  let claimed = false
  let active = false
  let draining = false
  let ended = false
  let pendingBytes = 0
  let failure: Error | null = null
  const pending: PtyEvent[] = []

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    observer = null
    pending.length = 0
    pendingBytes = 0
  }

  const fail = (): void => {
    failure ??= new Error('PTY event buffer exceeded its ownership-transfer limit')
    pending.length = 0
    pendingBytes = 0
  }

  const drain = (): void => {
    if (disposed || failure || !active || !observer || draining) return
    draining = true
    try {
      // Iterate by index so a maximally populated ownership-transfer buffer
      // drains in O(n). Events appended synchronously by an observer remain in
      // the same array and are consumed later in this pass, preserving source
      // order without a re-entrant drain.
      for (let index = 0; index < pending.length; index += 1) {
        const event = pending[index]!
        if (event.kind === 'data') pendingBytes -= event.ownershipTransferBufferedBytes
        if (event.kind === 'data') observer.onData(event.event)
        else observer.onExit(event.code, event.signal)
      }
      pending.length = 0
    } catch (error) {
      // An observer owns the business effects of the stream. Continuing after
      // one of those effects failed would publish later events over partial
      // state, so a non-conforming observer permanently loses the lease.
      dispose()
      throw error
    } finally {
      draining = false
    }
  }

  return {
    lease: {
      claim(nextObserver) {
        if (disposed || claimed) throw new Error('PTY event lease is unavailable')
        if (failure) throw failure
        claimed = true
        observer = nextObserver
        return {
          activate(): void {
            if (disposed || active) throw new Error('PTY event claim is unavailable')
            if (failure) throw failure
            active = true
            drain()
          },
          dispose,
        }
      },
      dispose,
    },
    sink: {
      data(event): void {
        if (disposed || ended || failure) return
        const ownershipTransferBufferedBytes = active ? 0 : Buffer.byteLength(event.data, 'utf8')
        if (!active) {
          pendingBytes += ownershipTransferBufferedBytes
          if (pendingBytes > maxPendingBytes || pending.length >= maxPendingEvents) {
            fail()
            return
          }
        }
        pending.push({ kind: 'data', event, ownershipTransferBufferedBytes })
        drain()
      },
      exit(code, signal): void {
        if (disposed || ended || failure) return
        if (!active && pending.length >= maxPendingEvents) {
          fail()
          return
        }
        ended = true
        pending.push({ kind: 'exit', code, signal })
        drain()
      },
    },
  }
}
