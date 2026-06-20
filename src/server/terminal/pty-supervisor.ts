// PtySupervisor interface. The boundary between the business runtime
// (which knows about sessions, ownership, catalogs) and the OS-level
// pty pool (which knows about node-pty and the IPC to a worker
// subprocess). The runtime calls into the supervisor to spawn/write/
// resize/kill; the supervisor emits data/exit via listeners.
//
// Layering: this is the server-side "source" abstraction for the
// terminal feature. Implementations live next to this file
// (`pty-supervisor-inprocess.ts`, `pty-supervisor-worker.ts`).

import type { PtySupervisorDiagnostics, PtySupervisorMode } from '#/server/terminal/terminal-host.ts'

export interface PtyHandle {
  readonly sessionId: string
}

export interface PtySpawnInput {
  command?: string
  args?: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export type PtySpawnResult = { ok: true; handle: PtyHandle; processName: string } | { ok: false; message: string }

// Owns the lifecycle of all live PTY sessions and forwards data/exit
// notifications to listeners registered by the business runtime. The
// implementation is either in-process (node-pty) or worker-backed (IPC
// to a dedicated subprocess).
export interface PtySupervisor {
  readonly mode: PtySupervisorMode
  spawn(input: PtySpawnInput): Promise<PtySpawnResult>
  write(handle: PtyHandle, data: string): void
  resize(handle: PtyHandle, cols: number, rows: number): void
  kill(handle: PtyHandle): void
  onData(handle: PtyHandle, listener: (data: string) => void): { dispose(): void }
  onExit(handle: PtyHandle, listener: (code: number | null, signal: NodeJS.Signals | null) => void): { dispose(): void }
  processName(handle: PtyHandle): string
  getDiagnostics(): PtySupervisorDiagnostics
  shutdown(): void
}

export function createPtyHandle(sessionId: string): PtyHandle {
  return { sessionId }
}
