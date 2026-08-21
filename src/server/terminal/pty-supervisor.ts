// Boundary between the business runtime and the OS-level PTY pool. Spawn
// transfers ordered data/exit ownership through a lease.

import type { PtySupervisorDiagnostics, PtySupervisorMode } from '#/server/terminal/terminal-host.ts'
import type { TerminalWriteResult } from '#/shared/terminal-types.ts'

export interface PtyHandle {
  readonly ptySessionId: string
}

export interface PtyDataEvent {
  data: string
  processName: string
}

export interface PtyEventObserver {
  onData(event: PtyDataEvent): void
  onExit(code: number | null, signal: NodeJS.Signals | null): void
}

export interface PtyEventClaim {
  activate(): void
  dispose(): void
}

export interface PtyEventLease {
  claim(observer: PtyEventObserver): PtyEventClaim
  dispose(): void
}

export interface PtySpawnInput {
  command?: string
  args?: string[]
  startupShellCommand?: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export type PtySpawnResult =
  { ok: true; handle: PtyHandle; processName: string; events: PtyEventLease } | { ok: false; message: string }

// Owns all live PTY resources and transfers each event stream at spawn.
export interface PtySupervisor {
  readonly mode: PtySupervisorMode
  spawn(input: PtySpawnInput): Promise<PtySpawnResult>
  write(handle: PtyHandle, data: string): Promise<TerminalWriteResult>
  resize(handle: PtyHandle, cols: number, rows: number): Promise<boolean>
  kill(handle: PtyHandle): void
  /** Durable completion for native exit or supervisor shutdown; it has no timeout. */
  waitForExit(handle: PtyHandle): Promise<void>
  killAndWait(handle: PtyHandle): Promise<void>
  getDiagnostics(): PtySupervisorDiagnostics
  shutdown(): void
}

export function createPtyHandle(ptySessionId: string): PtyHandle {
  return { ptySessionId }
}
