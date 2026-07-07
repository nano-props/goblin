import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'

type BufferedEntry = { type: 'send'; payload: string } | { type: 'close'; code?: number; reason?: string }

// Per-socket buffer used to pause realtime messages during authoritative
// request/response transitions so live events do not race ahead of the
// mutation response that owns the state boundary.
export class BufferedRealtimeSocket<TResumeContext = void> implements RealtimeSocket {
  private paused = 0
  private active = true
  private readonly buffer: BufferedEntry[] = []
  private readonly socket: RealtimeSocket
  private readonly onDeactivate?: () => void

  constructor(socket: RealtimeSocket, onDeactivate?: () => void) {
    this.socket = socket
    this.onDeactivate = onDeactivate
  }

  send(payload: string): void {
    if (!this.active) return
    if (this.paused > 0) {
      this.buffer.push({ type: 'send', payload })
      return
    }
    this.sendNow(payload)
  }

  close(code?: number, reason?: string): void {
    if (!this.active) return
    if (this.paused > 0) {
      this.buffer.push({ type: 'close', code, reason })
      return
    }
    this.closeNow(code, reason)
  }

  forceClose(code?: number, reason?: string): void {
    if (!this.active) return
    this.closeNow(code, reason)
    this.onDeactivate?.()
  }

  pause(): void {
    if (!this.active) return
    this.paused += 1
  }

  resume(context?: TResumeContext | null): void {
    if (this.paused === 0 || !this.active) return
    this.beforeResume(context ?? null)
    this.paused -= 1
    if (this.paused > 0) return
    this.flushBuffer()
    this.onBufferCleared()
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.paused = 0
    this.clearBuffer()
    this.onDeactivate?.()
  }

  protected beforeResume(_context: TResumeContext | null): void {}

  protected shouldDropBufferedSend(_payload: string): boolean {
    return false
  }

  protected onBufferCleared(): void {}

  private sendNow(payload: string): void {
    try {
      this.socket.send(payload)
    } catch {
      this.deactivate()
    }
  }

  private closeNow(code?: number, reason?: string): void {
    this.active = false
    this.clearBuffer()
    try {
      this.socket.close(code, reason)
    } catch {}
  }

  private flushBuffer(): void {
    for (const entry of this.buffer.splice(0)) {
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
    this.onBufferCleared()
  }
}
