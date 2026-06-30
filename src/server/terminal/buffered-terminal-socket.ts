// Per-socket buffer used to pause output during attach/restart so the
// replay in the response is not duplicated by live output events that
// arrived between the request and the response.
//
// Used by the server-side terminal runtime when it needs to hold
// back a single socket's `output` events while a long-running request
// (`attach` / `restart`) is being prepared. Multiple concurrent
// pauses stack via the `paused` counter; on `resume()` the buffer
// is drained in insertion order and any pending `close` ends the
// drain early (consistent with a real socket that won't accept
// further writes after closing).
//
// The class is generic over `TerminalRealtimeSocket` (a structural
// interface with `send`/`close`); the runtime wraps a Hono-provided
// WebSocket, the broker wraps whatever was passed to
// `registerSocket`.

import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'

type BufferedEntry = { type: 'send'; payload: string } | { type: 'close'; code?: number; reason?: string }

export class BufferedTerminalSocket implements TerminalRealtimeSocket {
  private paused = 0
  private active = true
  private readonly buffer: BufferedEntry[] = []
  private readonly socket: TerminalRealtimeSocket
  private readonly onDeactivate?: () => void

  constructor(socket: TerminalRealtimeSocket, onDeactivate?: () => void) {
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

  resume(): void {
    if (this.paused === 0 || !this.active) return
    this.paused -= 1
    if (this.paused > 0) return
    this.flushBuffer()
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.paused = 0
    this.buffer.length = 0
    this.onDeactivate?.()
  }

  private sendNow(payload: string): void {
    try {
      this.socket.send(payload)
    } catch {
      this.deactivate()
    }
  }

  private closeNow(code?: number, reason?: string): void {
    this.active = false
    this.buffer.length = 0
    try {
      this.socket.close(code, reason)
    } catch {}
  }

  private flushBuffer(): void {
    for (const entry of this.buffer.splice(0)) {
      if (!this.active) break
      if (entry.type === 'send') {
        this.sendNow(entry.payload)
        continue
      }
      this.closeNow(entry.code, entry.reason)
      break
    }
  }
}
