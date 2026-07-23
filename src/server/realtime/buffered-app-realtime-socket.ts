import { BufferedRealtimeSocket } from '#/server/realtime/buffered-realtime-socket.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { TerminalOutputCheckpoint } from '#/shared/terminal-types.ts'

export type AppRealtimeOutputFlushBoundary = TerminalOutputCheckpoint

export type AppRealtimeOutputFlushBoundaryContext =
  AppRealtimeOutputFlushBoundary | readonly AppRealtimeOutputFlushBoundary[]

export class BufferedAppRealtimeSocket extends BufferedRealtimeSocket<AppRealtimeOutputFlushBoundaryContext> {
  private readonly flushBoundaryByRuntimeBinding = new Map<string, AppRealtimeOutputFlushBoundary>()

  constructor(socket: RealtimeSocket, onDeactivate?: () => void) {
    super(socket, onDeactivate)
  }

  protected override beforeResume(boundary: AppRealtimeOutputFlushBoundaryContext | null): void {
    if (!boundary) return
    if ('terminalRuntimeSessionId' in boundary) {
      this.recordFlushBoundary(boundary)
      return
    }
    for (const entry of boundary) this.recordFlushBoundary(entry)
  }

  protected override shouldDropBufferedSend(payload: string): boolean {
    const event = parseTerminalOutputEvent(payload)
    if (!event) return false
    const boundary = this.flushBoundaryByRuntimeBinding.get(runtimeBindingKey(event))
    if (!boundary) return false
    return event.seq <= boundary.seq
  }

  protected override onBufferCleared(): void {
    this.flushBoundaryByRuntimeBinding.clear()
  }

  private recordFlushBoundary(boundary: AppRealtimeOutputFlushBoundary): void {
    const key = runtimeBindingKey(boundary)
    const current = this.flushBoundaryByRuntimeBinding.get(key)
    if (!current || isCheckpointAfter(boundary, current)) {
      this.flushBoundaryByRuntimeBinding.set(key, normalizeBoundary(boundary))
    }
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

function normalizeBoundary(boundary: AppRealtimeOutputFlushBoundary): AppRealtimeOutputFlushBoundary {
  return {
    terminalRuntimeSessionId: boundary.terminalRuntimeSessionId,
    terminalRuntimeGeneration: boundary.terminalRuntimeGeneration,
    seq: normalizeOutputNumber(boundary.seq),
  }
}

function runtimeBindingKey(binding: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }): string {
  return `${binding.terminalRuntimeSessionId}:${binding.terminalRuntimeGeneration}`
}

function isCheckpointAfter(next: AppRealtimeOutputFlushBoundary, current: AppRealtimeOutputFlushBoundary): boolean {
  return next.seq > current.seq
}

function normalizeOutputNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}
