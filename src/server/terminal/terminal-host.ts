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
  // `clientId` is a per-tab routing identifier (broker key, WS
  // query param, localStorage value). `ownerId` is a per-token
  // identity derived from the access token; it partitions the
  // in-memory session store so the same token shared across
  // browsers sees the same terminals. See `identity.ts` for the
  // full model. Both must be threaded explicitly at the host
  // boundary so the two identifiers cannot be conflated.
  registerSocket(
    clientId: string,
    attachmentId: string,
    ownerId: string,
    socket: ServerTerminalSocket,
  ): void
  unregisterSocket(
    clientId: string,
    attachmentId: string,
    ownerId: string,
    socket: ServerTerminalSocket,
  ): void
  attach(clientId: string, ownerId: string, input: TerminalAttachInput): MaybePromise<TerminalAttachResult>
  restart(clientId: string, ownerId: string, input: TerminalRestartInput): MaybePromise<TerminalAttachResult>
  write(clientId: string, ownerId: string, input: TerminalWriteInput): MaybePromise<TerminalMutationResult>
  resize(clientId: string, ownerId: string, input: TerminalResizeInput): MaybePromise<TerminalMutationResult>
  takeover(clientId: string, ownerId: string, input: TerminalTakeoverInput): MaybePromise<TerminalTakeoverResult>
  close(clientId: string, ownerId: string, input: TerminalSessionInput): MaybePromise<TerminalMutationResult>
  listSessions(clientId: string, ownerId: string, repoRoot: string): MaybePromise<TerminalSessionSummary[]>
  create(clientId: string, ownerId: string, input: TerminalCreateInput): MaybePromise<TerminalCatalogMutationResult>
  prune(clientId: string, ownerId: string, repoRoot: string): MaybePromise<{ pruned: number; remaining: number }>
  getSessionSnapshot(
    clientId: string,
    ownerId: string,
    input: TerminalSessionSnapshotInput,
  ): MaybePromise<TerminalSessionSnapshot | null>
  reorder(clientId: string, ownerId: string, input: TerminalReorderInput): MaybePromise<TerminalMutationResult>
  /** Handle an incoming realtime message from a client socket. */
  handleRealtimeMessage(
    clientId: string,
    attachmentId: string,
    ownerId: string,
    socket: ServerTerminalSocket,
    message: string,
  ): void
  shutdown(): void
}
