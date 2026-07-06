import { BufferedRealtimeSocket } from '#/server/realtime/buffered-realtime-socket.ts'
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
import type { TerminalRealtimeMessage } from '#/shared/terminal-socket.ts'

export interface TerminalOutputFlushBoundary {
  terminalRuntimeSessionId: string
  outputEra: number
  seq: number
}

export class BufferedTerminalSocket
  extends BufferedRealtimeSocket<TerminalOutputFlushBoundary>
  implements TerminalRealtimeSocket
{
  private readonly flushBoundaryByTerminalRuntimeSessionId = new Map<string, TerminalOutputFlushBoundary>()

  constructor(socket: TerminalRealtimeSocket, onDeactivate?: () => void) {
    super(socket, onDeactivate)
  }

  protected override beforeResume(boundary: TerminalOutputFlushBoundary | null): void {
    if (boundary) this.recordFlushBoundary(boundary)
  }

  protected override shouldDropBufferedSend(payload: string): boolean {
    const message = parseTerminalRealtimeMessage(payload)
    const event = message?.type === 'output' ? message.event : null
    if (!event) return false
    const boundary = this.flushBoundaryByTerminalRuntimeSessionId.get(event.terminalRuntimeSessionId)
    if (!boundary) return false
    if (event.outputEra !== boundary.outputEra) return event.outputEra < boundary.outputEra
    return event.seq <= boundary.seq
  }

  protected override onBufferCleared(): void {
    this.flushBoundaryByTerminalRuntimeSessionId.clear()
  }

  private recordFlushBoundary(boundary: TerminalOutputFlushBoundary): void {
    const current = this.flushBoundaryByTerminalRuntimeSessionId.get(boundary.terminalRuntimeSessionId)
    if (!current || isCheckpointAfter(boundary, current)) {
      this.flushBoundaryByTerminalRuntimeSessionId.set(boundary.terminalRuntimeSessionId, normalizeBoundary(boundary))
    }
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
