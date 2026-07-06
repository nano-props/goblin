// Per-socket buffer used to pause realtime messages during terminal
// frame transitions so live events do not race ahead of the
// authoritative mutation response.
//
// Used by the server-side terminal runtime when it needs to hold
// back a single socket's realtime events while a frame-transition
// request (`attach` / `restart` / `create` / `takeover`) is being
// prepared. Multiple concurrent
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
import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

type BufferedEntry = { type: 'send'; payload: string } | { type: 'close'; code?: number; reason?: string }

export interface TerminalOutputFlushBoundary {
  terminalRuntimeSessionId: string
  outputEra: number
  seq: number
}

export class BufferedTerminalSocket implements TerminalRealtimeSocket {
  private paused = 0
  private active = true
  private readonly buffer: BufferedEntry[] = []
  private readonly flushBoundaryByTerminalRuntimeSessionId = new Map<string, TerminalOutputFlushBoundary>()
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

  resume(boundary?: TerminalOutputFlushBoundary | null): void {
    if (this.paused === 0 || !this.active) return
    if (boundary) this.recordFlushBoundary(boundary)
    this.paused -= 1
    if (this.paused > 0) return
    this.flushBuffer()
  }

  deactivate(): void {
    if (!this.active) return
    this.active = false
    this.paused = 0
    this.buffer.length = 0
    this.flushBoundaryByTerminalRuntimeSessionId.clear()
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
    this.flushBoundaryByTerminalRuntimeSessionId.clear()
    try {
      this.socket.close(code, reason)
    } catch {}
  }

  private recordFlushBoundary(boundary: TerminalOutputFlushBoundary): void {
    const current = this.flushBoundaryByTerminalRuntimeSessionId.get(boundary.terminalRuntimeSessionId)
    if (!current || isCheckpointAfter(boundary, current)) {
      this.flushBoundaryByTerminalRuntimeSessionId.set(boundary.terminalRuntimeSessionId, normalizeBoundary(boundary))
    }
  }

  private flushBuffer(): void {
    for (const entry of this.buffer.splice(0)) {
      if (!this.active) break
      if (entry.type === 'send') {
        if (this.isOutputCoveredByFlushBoundary(entry.payload)) continue
        this.sendNow(entry.payload)
        continue
      }
      this.closeNow(entry.code, entry.reason)
      break
    }
    this.flushBoundaryByTerminalRuntimeSessionId.clear()
  }

  private isOutputCoveredByFlushBoundary(payload: string): boolean {
    const message = parseTerminalRealtimeMessage(payload)
    const event = message?.type === 'output' ? message.event : null
    if (!event) return false
    const boundary = this.flushBoundaryByTerminalRuntimeSessionId.get(event.terminalRuntimeSessionId)
    if (!boundary) return false
    if (event.outputEra !== boundary.outputEra) return event.outputEra < boundary.outputEra
    return event.seq <= boundary.seq
  }
}

function parseTerminalRealtimeMessage(payload: string): TerminalRealtimeMessage | null {
  try {
    const parsed = JSON.parse(payload) as TerminalRealtimeMessage
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.type === 'output' && !isTerminalOutputMessage(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function isTerminalOutputMessage(message: TerminalRealtimeMessage): message is Extract<TerminalRealtimeMessage, { type: 'output' }> {
  if (message.type !== 'output') return false
  const event = message.event
  return (
    event !== null &&
    typeof event === 'object' &&
    typeof event.terminalRuntimeSessionId === 'string' &&
    typeof event.outputEra === 'number' &&
    typeof event.seq === 'number'
  )
}

function normalizeBoundary(boundary: TerminalOutputFlushBoundary): TerminalOutputFlushBoundary {
  return {
    terminalRuntimeSessionId: boundary.terminalRuntimeSessionId,
    outputEra: normalizeOutputNumber(boundary.outputEra),
    seq: normalizeOutputNumber(boundary.seq),
  }
}

function isCheckpointAfter(next: TerminalOutputFlushBoundary, current: TerminalOutputFlushBoundary): boolean {
  if (next.outputEra !== current.outputEra) return next.outputEra > current.outputEra
  return next.seq > current.seq
}

function normalizeOutputNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
