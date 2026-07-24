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
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return null
    if ((parsed as { type?: unknown }).type !== 'output') return null
    const event = (parsed as { event?: unknown }).event
    if (!event || typeof event !== 'object') return null
    const maybeEvent = event as {
      terminalRuntimeSessionId?: unknown
      terminalRuntimeGeneration?: unknown
      seq?: unknown
    }
    if (
      typeof maybeEvent.terminalRuntimeSessionId !== 'string' ||
      !Number.isSafeInteger(maybeEvent.terminalRuntimeGeneration) ||
      !Number.isSafeInteger(maybeEvent.seq)
    ) {
      return null
    }
    return {
      terminalRuntimeSessionId: maybeEvent.terminalRuntimeSessionId,
      terminalRuntimeGeneration: maybeEvent.terminalRuntimeGeneration as number,
      seq: maybeEvent.seq as number,
    }
  } catch {
    return null
  }
}
