import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'

type BufferedEntry = { type: 'send'; payload: string } | { type: 'close'; code?: number; reason?: string }
type RealtimeTransition<TFlushContext> = () => Promise<TFlushContext | null>

export const MAX_BUFFERED_REALTIME_BYTES = 16 * 1024 * 1024
export const MAX_BUFFERED_REALTIME_ENTRIES = 65_536
export const MAX_QUEUED_REALTIME_TRANSITIONS = 8

const BUFFER_CAPACITY_CLOSE_CODE = 1013
const BUFFER_CAPACITY_CLOSE_REASON = 'realtime buffer capacity exceeded'
const TRANSITION_CAPACITY_CLOSE_REASON = 'realtime transition capacity exceeded'
const INTERNAL_ERROR_CLOSE_CODE = 1011
const SEND_FAILED_CLOSE_REASON = 'realtime send failed'
const TRANSITION_FAILED_CLOSE_REASON = 'realtime transition failed'

// Serializes the request/response transitions whose authoritative response
// must precede realtime effects produced while that request is running.
// Realtime effects are buffered only for the active transition and flushed
// before the next transition begins.
export class BufferedRealtimeSocket<TFlushContext = void> implements RealtimeSocket {
  private active = true
  private transitionActive = false
  private readonly transitions: Array<RealtimeTransition<TFlushContext>> = []
  private readonly buffer: BufferedEntry[] = []
  private bufferedBytes = 0
  private readonly socket: RealtimeSocket
  private readonly onRelease?: () => void

  constructor(socket: RealtimeSocket, onRelease?: () => void) {
    this.socket = socket
    this.onRelease = onRelease
  }

  send(payload: string): void {
    if (!this.active) return
    if (this.transitionActive) {
      const bytes = Buffer.byteLength(payload, 'utf8')
      if (!this.hasBufferCapacity(bytes)) {
        this.forceClose(BUFFER_CAPACITY_CLOSE_CODE, BUFFER_CAPACITY_CLOSE_REASON)
        return
      }
      this.buffer.push({ type: 'send', payload })
      this.bufferedBytes += bytes
      return
    }
    this.sendNow(payload)
  }

  close(code?: number, reason?: string): void {
    if (!this.active) return
    if (this.transitionActive) {
      if (!this.hasBufferCapacity(0)) {
        this.forceClose(BUFFER_CAPACITY_CLOSE_CODE, BUFFER_CAPACITY_CLOSE_REASON)
        return
      }
      this.buffer.push({ type: 'close', code, reason })
      return
    }
    this.closeNow(code, reason)
  }

  forceClose(code?: number, reason?: string): void {
    if (!this.active) return
    this.closeNow(code, reason)
  }

  enqueueTransition(transition: RealtimeTransition<TFlushContext>): void {
    if (!this.active) return
    if (this.transitions.length >= MAX_QUEUED_REALTIME_TRANSITIONS) {
      this.forceClose(BUFFER_CAPACITY_CLOSE_CODE, TRANSITION_CAPACITY_CLOSE_REASON)
      return
    }
    this.transitions.push(transition)
    this.startNextTransition()
  }

  // Release retained state when registration fails or the raw transport has
  // already closed. Internal failures must use forceClose so they cannot leave
  // an open transport outside broker ownership.
  release(): void {
    if (!this.active) return
    this.active = false
    this.clearRetainedState()
    this.onRelease?.()
  }

  protected beforeFlush(_context: TFlushContext | null): void {}

  protected shouldDropBufferedSend(_payload: string): boolean {
    return false
  }

  protected onBufferCleared(): void {}

  // A finite slow-reader backlog after `send` belongs to the raw WebSocket/TCP
  // transport, not this ordering buffer. It drains as the peer reads and is
  // reclaimed with the raw socket when the peer disconnects; this wrapper
  // retains only the explicitly bounded transition state above.
  private sendNow(payload: string): void {
    try {
      this.socket.send(payload)
    } catch {
      this.forceClose(INTERNAL_ERROR_CLOSE_CODE, SEND_FAILED_CLOSE_REASON)
    }
  }

  private closeNow(code?: number, reason?: string): void {
    this.active = false
    this.clearRetainedState()
    try {
      this.socket.close(code, reason)
    } catch {}
    this.onRelease?.()
  }

  private startNextTransition(): void {
    if (!this.active || this.transitionActive) return
    const transition = this.transitions.shift()
    if (!transition) return
    this.transitionActive = true
    void this.finishTransition(transition)
  }

  private async finishTransition(transition: RealtimeTransition<TFlushContext>): Promise<void> {
    try {
      const context = await transition()
      if (!this.active) return
      this.beforeFlush(context)
      this.flushBuffer()
      if (this.active) this.onBufferCleared()
    } catch {
      this.forceClose(INTERNAL_ERROR_CLOSE_CODE, TRANSITION_FAILED_CLOSE_REASON)
    } finally {
      this.transitionActive = false
      this.startNextTransition()
    }
  }

  private flushBuffer(): void {
    const entries = this.buffer.splice(0)
    this.bufferedBytes = 0
    for (const entry of entries) {
      if (!this.active) break
      if (entry.type === 'send') {
        if (this.shouldDropBufferedSend(entry.payload)) continue
        this.sendNow(entry.payload)
        continue
      }
      this.closeNow(entry.code, entry.reason)
      break
    }
  }

  private clearBuffer(): void {
    this.buffer.length = 0
    this.bufferedBytes = 0
    this.onBufferCleared()
  }

  private clearRetainedState(): void {
    this.transitions.length = 0
    this.clearBuffer()
  }

  private hasBufferCapacity(additionalBytes: number): boolean {
    return (
      this.buffer.length < MAX_BUFFERED_REALTIME_ENTRIES &&
      additionalBytes <= MAX_BUFFERED_REALTIME_BYTES - this.bufferedBytes
    )
  }
}
