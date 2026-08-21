import { BufferedRealtimeSocket } from '#/server/realtime/buffered-realtime-socket.ts'
import type { TerminalOutputCheckpoint } from '#/shared/terminal-types.ts'

export class BufferedAppRealtimeSocket extends BufferedRealtimeSocket<TerminalOutputCheckpoint> {
  private flushBoundary: TerminalOutputCheckpoint | null = null

  protected override beforeFlush(boundary: TerminalOutputCheckpoint | null): void {
    this.flushBoundary = boundary
  }

  protected override shouldDropBufferedSend(payload: string): boolean {
    const event = parseTerminalOutputEvent(payload)
    if (!event) return false
    const boundary = this.flushBoundary
    if (!boundary) return false
    if (
      event.terminalRuntimeSessionId !== boundary.terminalRuntimeSessionId ||
      event.terminalRuntimeGeneration !== boundary.terminalRuntimeGeneration
    )
      return false
    return event.seq <= boundary.seq
  }

  protected override onBufferCleared(): void {
    this.flushBoundary = null
  }
}

function parseTerminalOutputEvent(payload: string): TerminalOutputCheckpoint | null {
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== 'object' || Reflect.get(parsed, 'type') !== 'output') return null
    const event = Reflect.get(parsed, 'event')
    if (!event || typeof event !== 'object') return null
    const terminalRuntimeSessionId = Reflect.get(event, 'terminalRuntimeSessionId')
    const terminalRuntimeGeneration = Reflect.get(event, 'terminalRuntimeGeneration')
    const seq = Reflect.get(event, 'seq')
    if (
      typeof terminalRuntimeSessionId !== 'string' ||
      !isSafeInteger(terminalRuntimeGeneration) ||
      !isSafeInteger(seq)
    ) {
      return null
    }
    return { terminalRuntimeSessionId, terminalRuntimeGeneration, seq }
  } catch {
    return null
  }
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}
