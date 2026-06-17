import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalMutationResult,
  TerminalReorderInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverInput,
  TerminalTakeoverResult,
  TerminalWriteInput,
} from '#/shared/terminal-types.ts'

type MaybePromise<T> = T | Promise<T>

// Re-export the broker's socket interface as the host's socket
// interface. They are structurally identical; the host's contract
// for a realtime socket is the same as the broker's contract for
// one. Defining the alias here (instead of duplicating the shape)
// keeps the two layers in lockstep when the wire protocol grows.
import type { TerminalRealtimeSocket } from '#/server/terminal/terminal-realtime-broker.ts'
export type { TerminalRealtimeSocket }
export type ServerTerminalSocket = TerminalRealtimeSocket

export type ServerTerminalHostState = 'running' | 'shutting-down'

export type PtySupervisorMode = 'in-process' | 'worker-backed'

export type PtySupervisorState = 'idle' | 'running' | 'restarting' | 'shutting-down'

export interface PtySupervisorFailureDiagnostics {
  kind: 'exit' | 'error' | 'send-failed'
  at: number
  detail: string
}

export interface PtySupervisorDiagnostics {
  mode: PtySupervisorMode
  state: PtySupervisorState
  workerRunning: boolean
  workerPid: number | null
  workerStartedAt: number | null
  workerUptimeMs: number | null
  pendingRequests: number
  restartAttempts: number
  restartScheduled: boolean
  shuttingDown: boolean
  lastSuccessfulResponseAt: number | null
  lastExitCode: number | null
  lastExitSignal: NodeJS.Signals | null
  lastFailure: PtySupervisorFailureDiagnostics | null
}

export interface ServerTerminalHostDiagnostics {
  mode: PtySupervisorMode
  state: ServerTerminalHostState
  registeredSockets: number
  shuttingDown: boolean
  pty: PtySupervisorDiagnostics
  /**
   * T4.1: aggregate stats across all live terminal sessions.
   * `liveSessionCount` is the number of in-memory sessions owned by
   * the manager; `totalRingBufferChars` and `maxRingBufferChars` are
   * the sum and the maximum per-session replay buffer size, in
   * JavaScript string chars (close to bytes for ASCII-heavy terminal
   * output; an upper bound is `chars * 2` for full UTF-16).
   */
  liveSessionCount: number
  totalRingBufferChars: number
  maxRingBufferChars: number
}

export interface ServerTerminalHost {
  isValidClientId(value: unknown): value is string
  getDiagnostics(): ServerTerminalHostDiagnostics
  registerSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  unregisterSocket(clientId: string, attachmentId: string, socket: ServerTerminalSocket): void
  attach(clientId: string, input: TerminalAttachInput): MaybePromise<TerminalAttachResult>
  restart(clientId: string, input: TerminalRestartInput): MaybePromise<TerminalAttachResult>
  write(clientId: string, input: TerminalWriteInput): MaybePromise<TerminalMutationResult>
  resize(clientId: string, input: TerminalResizeInput): MaybePromise<TerminalMutationResult>
  takeover(clientId: string, input: TerminalTakeoverInput): MaybePromise<TerminalTakeoverResult>
  close(clientId: string, input: TerminalSessionInput): MaybePromise<TerminalMutationResult>
  listSessions(clientId: string, repoRoot: string): MaybePromise<TerminalSessionSummary[]>
  create(clientId: string, input: TerminalCreateInput): MaybePromise<TerminalCatalogMutationResult>
  prune(clientId: string, repoRoot: string): MaybePromise<{ pruned: number; remaining: number }>
  getSessionSnapshot(
    clientId: string,
    input: TerminalSessionSnapshotInput,
  ): MaybePromise<TerminalSessionSnapshot | null>
  reorder(clientId: string, input: TerminalReorderInput): MaybePromise<TerminalMutationResult>
  /** Handle an incoming realtime message from a client socket. */
  handleRealtimeMessage(clientId: string, attachmentId: string, socket: ServerTerminalSocket, message: string): void
  shutdown(): void
}
